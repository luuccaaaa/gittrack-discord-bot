const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { initializeWebServer } = require('../src/handlers/webhookHandler');
const { patchEventConfig } = require('../src/functions/eventConfig');
const editEvent = require('../src/commands/edit-event');

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

const setPing = (prisma, event, roleId) => patchEventConfig(prisma, 'g1', 'r1', event, { pingRoleIds: roleId ? [roleId] : [] });
const setNoLimit = (prisma, on) => patchEventConfig(prisma, 'g1', 'r1', 'release', { noLimit: on });

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

      await setPing(prisma, event, '777');
      await post(url, event, payload);
      assert.equal(bot.sent.length, 2);
      assert.equal(bot.sent[1].content, '<@&777>', `${event} ping`);
      assert.deepEqual(bot.sent[1].allowedMentions, { roles: ['777'] });

      await setPing(prisma, event, null);
      await post(url, event, payload);
      assert.equal(bot.sent[2].content, undefined, `${event} ping removed`);
    });
  }
});

test('ping on one event type does not leak to another', async () => {
  const prisma = makePrisma();
  const bot = makeBot();
  await withServer(prisma, bot, async (url) => {
    await setPing(prisma, 'issues', '1');
    await post(url, 'star', PAYLOADS.star);
    assert.equal(bot.sent[0].content, undefined);
  });
});

test('release: default truncates, noLimit sends everything, can be turned off', async () => {
  const prisma = makePrisma();
  const bot = makeBot();
  const long = Array.from({ length: 900 }, (_, i) => `- change number ${i}`).join('\n');
  await withServer(prisma, bot, async (url) => {
    await post(url, 'release', release(long));
    assert.equal(bot.sent.length, 1);
    assert.ok(bot.sent[0].embeds[0].description.length <= 1500);

    await setNoLimit(prisma, true);
    await setPing(prisma, 'release', '9');

    bot.sent.length = 0;
    await post(url, 'release', release(long));
    assert.ok(bot.sent.length > 1, 'split into several messages');
    const all = bot.sent.map(m => m.embeds[0].description).join('\n');
    assert.equal(all.replace(/\s/g, ''), long.replace(/\s/g, ''), 'nothing lost');
    assert.ok(bot.sent.every(m => m.embeds[0].description.length <= 4096));
    assert.equal(bot.sent[0].content, '<@&9>');
    assert.ok(bot.sent.slice(1).every(m => m.content === undefined), 'ping only once');
    assert.ok(bot.sent[0].embeds[0].title.includes('Release'));

    await setNoLimit(prisma, false);
    bot.sent.length = 0;
    await post(url, 'release', release(long));
    assert.equal(bot.sent.length, 1);
    assert.ok(bot.sent[0].embeds[0].description.length <= 1500);
    assert.equal(bot.sent[0].content, '<@&9>', 'ping survives toggling the limit');
  });
});

test('config changes reject a repository from another server', async () => {
  const prisma = makePrisma();
  assert.equal(await patchEventConfig(prisma, 'other', 'r1', 'issues', { pingRoleIds: ['1'] }), false);
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
    prisma.rows.push({ id: 'seed', repositoryId: 'r1', eventType: type, channelId: 'default', config: { explicitChannel: false, actionsEnabled: actions || {}, pingRoleIds: ['55'] } });
    await withServer(prisma, bot, async (url) => {
      assert.equal(await post(url, event, payload), 200, `${event} status`);
      assert.equal(bot.sent.length, 1, `${event} sent`);
      assert.equal(bot.sent[0].content, '<@&55>', `${event} ping`);
    });
  }
});

// /edit-event editor: drive the component collector directly.
async function openEditor(prisma, eventType, { guildId = 'g1', canMentionEveryone = false } = {}) {
  const handlers = {};
  const replies = [];
  const message = { createMessageComponentCollector: () => ({ on: (e, fn) => { handlers[e] = fn; }, stop: () => {} }) };
  await editEvent.execute({
    guildId,
    user: { id: 'u1' },
    guild: { members: { me: { permissions: { has: () => canMentionEveryone } } } },
    options: { getString: (k) => ({ repository: 'r1', event: eventType })[k] },
    deferReply: async () => {},
    editReply: async (m) => { replies.push(m); return message; },
  }, prisma);
  const click = async (customId, extra = {}) => {
    const calls = { update: [], followUp: [] };
    await handlers.collect({
      customId, user: { id: 'u1' }, ...extra,
      update: async (m) => { calls.update.push(m); },
      followUp: async (m) => { calls.followUp.push(m); },
      reply: async (m) => { calls.followUp.push(m); },
      deferUpdate: async () => {},
    });
    return calls;
  };
  // roles: [[id, mentionable], ...] as picked in the role select
  const pick = (...roles) => ({ values: roles.map(([id]) => id), roles: new Map(roles.map(([id, mentionable]) => [id, { id, mentionable }])) });
  return { replies, click, pick };
}

const cfg = (prisma, eventType) => prisma.rows.find(r => r.eventType === eventType).config;
const rowTypes = (rows) => rows.map(r => r.toJSON().components.map(c => c.type));

test('edit-event: role select, release toggle and action toggles share one config', async () => {
  const prisma = makePrisma();
  const bot = makeBot();
  const { replies, click, pick } = await openEditor(prisma, 'release');

  // published button, role select (type 6), then [full notes] [close]
  assert.deepEqual(rowTypes(replies[0].components), [[2], [6], [2, 2]]);

  assert.equal(replies[0].components[1].toJSON().components[0].max_values, 5);
  const sel = await click('edit_evt_role:r1:release', pick(['777', true], ['888', true]));
  assert.deepEqual(cfg(prisma, 'release').pingRoleIds, ['777', '888']);
  assert.equal(sel.followUp.length, 0, 'mentionable roles: no warning');
  assert.deepEqual(sel.update[0].components[1].toJSON().components[0].default_values, [{ id: '777', type: 'role' }, { id: '888', type: 'role' }]);
  assert.ok(sel.update[0].embeds[0].toJSON().fields.some(f => f.value === '<@&777> <@&888>'), 'embed lists both roles');

  await click('edit_evt_opt:r1:release:noLimit');
  assert.equal(cfg(prisma, 'release').noLimit, true);

  await click('edit_evt:r1:release:published'); // off
  await click('edit_evt:r1:release:published'); // back on
  assert.deepEqual(cfg(prisma, 'release').pingRoleIds, ['777', '888'], 'action toggles keep the ping roles');
  assert.equal(cfg(prisma, 'release').noLimit, true, 'action toggles keep noLimit');

  const long = Array.from({ length: 900 }, (_, i) => `- change number ${i}`).join('\n');
  await withServer(prisma, bot, async (url) => {
    await post(url, 'release', release(long));
    assert.ok(bot.sent.length > 1, 'full notes split');
    assert.equal(bot.sent[0].content, '<@&777> <@&888>');
    assert.deepEqual(bot.sent[0].allowedMentions, { roles: ['777', '888'] });
  });

  await click('edit_evt_role:r1:release', pick());
  assert.deepEqual(cfg(prisma, 'release').pingRoleIds, [], 'empty selection removes the ping');
});

test('edit-event: rejects @everyone and warns about unmentionable roles', async () => {
  const prisma = makePrisma();
  const { replies, click, pick } = await openEditor(prisma, 'issues');
  // 7 actions -> two button rows, role select, close
  assert.deepEqual(rowTypes(replies[0].components), [[2, 2, 2, 2, 2], [2, 2], [6], [2]]);

  const everyone = await click('edit_evt_role:r1:issues', pick(['g1', true], ['5', true]));
  assert.deepEqual(cfg(prisma, 'issues').pingRoleIds, ['5'], '@everyone dropped, other role kept');
  assert.match(everyone.followUp[0].content, /everyone/);

  const hidden = await click('edit_evt_role:r1:issues', pick(['42', false], ['5', true], ['43', false]));
  assert.deepEqual(cfg(prisma, 'issues').pingRoleIds, ['42', '5', '43'], 'saved anyway');
  assert.match(hidden.followUp[0].content, /<@&42>, <@&43> aren't mentionable/);
  assert.doesNotMatch(hidden.followUp[0].content, /<@&5>/);

  const prisma2 = makePrisma();
  const ed2 = await openEditor(prisma2, 'issues', { canMentionEveryone: true });
  const ok = await ed2.click('edit_evt_role:r1:issues', ed2.pick(['42', false]));
  assert.equal(ok.followUp.length, 0, 'no warning when bot can Mention Everyone');
});

test('workflow_run and check_run ping once per event, not once per matching branch', async () => {
  const CI = {
    workflow_run: { action: 'completed', workflow_run: { name: 'CI', html_url: 'http://w', jobs_url: 'http://j', conclusion: 'success', head_branch: 'main', head_sha: 'abcdef1234', run_started_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
    check_run: { action: 'completed', check_run: { name: 'lint', conclusion: 'success', html_url: 'http://c', head_sha: 'abcdef1234', check_suite: { head_branch: 'main' } } },
  };
  for (const [event, payload] of Object.entries(CI)) {
    const prisma = makePrisma();
    const bot = makeBot();
    prisma.trackedBranch.findMany = async () => [{ branchName: 'main', channelId: 'c1' }, { branchName: '*', channelId: 'c2' }];
    prisma.rows.push({ id: 'seed', repositoryId: 'r1', eventType: event, channelId: 'default', config: { explicitChannel: false, actionsEnabled: { completed: true }, pingRoleIds: ['55'] } });
    await withServer(prisma, bot, async (url) => {
      assert.equal(await post(url, event, payload), 200);
      assert.equal(bot.sent.length, 2, `${event}: one message per matching branch`);
      assert.equal(bot.sent[0].content, '<@&55>', `${event}: first message pings`);
      assert.equal(bot.sent[1].content, undefined, `${event}: second message does not ping again`);
    });
  }
});

test('/status lists ping roles and full release notes, and hides default-channel mappings', async () => {
  const status = require('../src/commands/status');
  const repo = {
    ...REPO, trackedBranches: [],
    eventChannels: [
      { eventType: 'issues', channelId: 'default', config: { pingRoleIds: ['1', '2'] } },
      { eventType: 'release', channelId: 'rel', config: { explicitChannel: true, noLimit: true, pingRoleIds: ['3'] } },
      { eventType: 'star', channelId: 'default', config: { actionsEnabled: {} } },
    ],
  };
  const server = { id: 's1', guildId: 'g1', maxRepos: null, repositories: [repo] };
  const prisma = { server: { findUnique: async () => server }, repository: { count: async () => 1 } };
  const replies = [];
  await status.execute({
    guildId: 'g1', guild: { name: 'G' },
    deferReply: async () => {}, editReply: async (m) => { replies.push(m); },
  }, prisma);
  const field = replies[0].embeds[0].toJSON().fields.find(f => f.name === REPO.url);
  assert.ok(field, 'repo field present');
  assert.match(field.value, /\*\*Event Routing\*\*:\n\*\*<#rel>\*\*: `release`/);
  assert.doesNotMatch(field.value, /<#default>/);
  assert.match(field.value, /`issues` → <@&1> <@&2>/);
  assert.match(field.value, /`release` → <@&3> · full notes/);
  assert.doesNotMatch(field.value, /`star` →/);

  repo.eventChannels = Array.from({ length: 12 }, (_, n) => ({ eventType: `e${n}`, channelId: 'default', config: { pingRoleIds: ['111111111111111111', '222222222222222222', '333333333333333333', '444444444444444444', '555555555555555555'] } }));
  replies.length = 0;
  await status.execute({ guildId: 'g1', guild: { name: 'G' }, deferReply: async () => {}, editReply: async (m) => { replies.push(m); } }, prisma);
  assert.ok(replies[0].embeds, 'still renders');
  assert.ok(replies[0].embeds[0].toJSON().fields.every(f => f.value.length <= 1024), 'field within Discord limit');
});
