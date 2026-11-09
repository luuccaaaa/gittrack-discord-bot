const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { initializeWebServer } = require('../src/handlers/webhookHandler');
const setPing = require('../src/commands/set-ping-role');
const relUnl = require('../src/commands/release-unlimited');

const SECRET = 's3cret';
const REPO = {
  id: 'r1', url: 'https://github.com/o/r', webhookSecret: SECRET, notificationChannelId: 'chan', serverId: 's1',
  server: { id: 's1', guildId: 'g1', maxRepos: null },
};

// In-memory prisma: the event-channel table is real; everything else is a harmless stub.
function makePrisma() {
  const rows = [];
  let n = 0;
  const match = (w) => (r) => Object.entries(w).every(([k, v]) => r[k] === v);
  return {
    rows,
    repository: {
      findMany: async () => [REPO],
      findFirst: async ({ where }) => (where.id === REPO.id && where.server.guildId === 'g1' ? REPO : null),
      count: async () => 1,
    },
    repositoryEventChannel: {
      findFirst: async ({ where }) => rows.find(match(where)) || null,
      create: async ({ data }) => { const r = { id: `e${++n}`, ...data }; rows.push(r); return r; },
      update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data),
    },
    server: { update: async () => ({}), findUnique: async () => ({ maxRepos: null }), findMany: async () => [] },
    trackedBranch: { findMany: async () => [] },
    errorLog: { create: async () => ({}) },
  };
}

function makeBot() {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (m) => { sent.push(m); return { id: `m${sent.length}` }; } };
  return { sent, channels: { fetch: async () => channel } };
}

async function withServer(prisma, bot, fn) {
  const server = initializeWebServer(prisma, bot).listen(0);
  try { await fn(`http://127.0.0.1:${server.address().port}/github-webhook`); } finally { server.close(); }
}

async function post(url, event, payload) {
  const body = JSON.stringify({ repository: { html_url: REPO.url, full_name: 'o/r' }, sender: user(), ...payload });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(url, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sig },
  });
  return res.status;
}

function interaction(strings, roles, bools = {}, reply = []) {
  return {
    guildId: 'g1',
    deferReply: async () => {},
    editReply: async (m) => { reply.push(m); },
    options: {
      getString: (k) => strings[k],
      getRole: (k) => roles[k],
      getBoolean: (k) => bools[k],
    },
  };
}

const user = () => ({ login: 'u', avatar_url: 'http://a/x.png', html_url: 'http://a/u' });
const PAYLOADS = {
  issues: { action: 'opened', issue: { number: 1, title: 't', html_url: 'http://i', state: 'open', user: user(), body: 'b', labels: [] } },
  pull_request: { action: 'opened', pull_request: { number: 1, title: 't', html_url: 'http://p', state: 'open', user: user(), body: 'b', merged: false, draft: false, head: { ref: 'a' }, base: { ref: 'main' } } },
  star: { action: 'created', repository: { html_url: REPO.url, full_name: 'o/r', stargazers_count: 3 } },
  fork: { forkee: { full_name: 'x/r', html_url: 'http://f', owner: user() } },
  create: { ref_type: 'tag', ref: 'v1' }, // real create/delete/fork payloads have no `action`
  delete: { ref_type: 'tag', ref: 'v1' },
  milestone: { action: 'created', milestone: { title: 'm', html_url: 'http://m', description: 'd', creator: user(), open_issues: 0, closed_issues: 0, due_on: null } },
};
const release = (body) => ({
  action: 'published',
  release: { name: 'R', tag_name: 'v1', html_url: 'http://r', prerelease: false, author: user(), body, published_at: new Date().toISOString() },
});

test('every event type posts the role ping once the role is set, and none before', async () => {
  for (const [event, payload] of Object.entries(PAYLOADS)) {
    const prisma = makePrisma();
    const bot = makeBot();
    await withServer(prisma, bot, async (url) => {
      assert.equal(await post(url, event, payload), 200, `${event} status`);
      assert.equal(bot.sent.length, 1, `${event} posted without ping`);
      assert.equal(bot.sent[0].content, undefined, `${event} no ping by default`);

      await setPing.execute(interaction({ repository: 'r1', event }, { role: { id: '777' } }), prisma);
      await post(url, event, payload);
      assert.equal(bot.sent.length, 2);
      assert.equal(bot.sent[1].content, '<@&777>', `${event} ping`);
      assert.deepEqual(bot.sent[1].allowedMentions, { roles: ['777'] });

      await setPing.execute(interaction({ repository: 'r1', event }, { role: null }), prisma);
      await post(url, event, payload);
      assert.equal(bot.sent[2].content, undefined, `${event} ping removed`);
    });
  }
});

test('ping on one event type does not leak to another', async () => {
  const prisma = makePrisma();
  const bot = makeBot();
  await withServer(prisma, bot, async (url) => {
    await setPing.execute(interaction({ repository: 'r1', event: 'issues' }, { role: { id: '1' } }), prisma);
    await post(url, 'star', PAYLOADS.star);
    assert.equal(bot.sent[0].content, undefined);
  });
});

test('release: default truncates, /release-unlimited sends everything, can be turned off', async () => {
  const prisma = makePrisma();
  const bot = makeBot();
  const long = Array.from({ length: 900 }, (_, i) => `- change number ${i}`).join('\n');
  await withServer(prisma, bot, async (url) => {
    await post(url, 'release', release(long));
    assert.equal(bot.sent.length, 1);
    assert.ok(bot.sent[0].embeds[0].description.length <= 1500);

    const reply = [];
    await relUnl.execute(interaction({ repository: 'r1' }, {}, { enabled: true }, reply), prisma);
    assert.match(reply.at(-1), /removed/);
    await setPing.execute(interaction({ repository: 'r1', event: 'release' }, { role: { id: '9' } }), prisma);

    bot.sent.length = 0;
    await post(url, 'release', release(long));
    assert.ok(bot.sent.length > 1, 'split into several messages');
    const all = bot.sent.map(m => m.embeds[0].description).join('\n');
    assert.equal(all.replace(/\s/g, ''), long.replace(/\s/g, ''), 'nothing lost');
    assert.ok(bot.sent.every(m => m.embeds[0].description.length <= 4096));
    assert.equal(bot.sent[0].content, '<@&9>');
    assert.ok(bot.sent.slice(1).every(m => m.content === undefined), 'ping only once');
    assert.ok(bot.sent[0].embeds[0].title.includes('Release'));

    await relUnl.execute(interaction({ repository: 'r1' }, {}, { enabled: false }, reply), prisma);
    bot.sent.length = 0;
    await post(url, 'release', release(long));
    assert.equal(bot.sent.length, 1);
    assert.ok(bot.sent[0].embeds[0].description.length <= 1500);
    assert.equal(bot.sent[0].content, '<@&9>', 'ping survives toggling the limit');
  });
});

test('commands reject a repository from another server', async () => {
  const prisma = makePrisma();
  const reply = [];
  const i = interaction({ repository: 'r1', event: 'issues' }, { role: { id: '1' } }, {}, reply);
  i.guildId = 'other';
  await setPing.execute(i, prisma);
  assert.match(reply.at(-1), /not found/i);
  assert.equal(prisma.rows.length, 0);
});

// Remaining handlers that send through the same helper (review, comments, CI events).
const EXTRA = {
  pull_request_review: { type: 'pull_request', payload: { action: 'submitted', review: { state: 'approved', html_url: 'http://rv', body: 'ok' }, pull_request: { number: 1, title: 't', html_url: 'http://p' } } },
  issue_comment: { type: 'issues', actions: { comments: true }, payload: { action: 'created', issue: { number: 1, title: 't', html_url: 'http://i' }, comment: { html_url: 'http://c', body: 'hi' } } },
  workflow_job: { type: 'workflow_job', payload: { action: 'completed', workflow_job: { name: 'build', conclusion: 'success', status: 'completed', html_url: 'http://w', head_branch: 'main' } } },
  check_suite: { type: 'check_suite', payload: { action: 'completed', check_suite: { conclusion: 'success', head_branch: 'main', head_sha: 'abcdef1234', url: 'http://cs' } } },
};

test('review, comment and CI events also carry the role ping', async () => {
  for (const [event, { type, actions, payload }] of Object.entries(EXTRA)) {
    const prisma = makePrisma();
    const bot = makeBot();
    prisma.rows.push({ id: 'seed', repositoryId: 'r1', eventType: type, channelId: 'default', config: { explicitChannel: false, actionsEnabled: actions || {}, pingRoleId: '55' } });
    await withServer(prisma, bot, async (url) => {
      assert.equal(await post(url, event, payload), 200, `${event} status`);
      assert.equal(bot.sent.length, 1, `${event} sent`);
      assert.equal(bot.sent[0].content, '<@&55>', `${event} ping`);
    });
  }
});
