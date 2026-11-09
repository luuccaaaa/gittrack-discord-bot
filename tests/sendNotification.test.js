const test = require('node:test');
const assert = require('node:assert/strict');

const { sendNotification, splitText } = require('../src/functions/sendNotification');

test('splitText keeps every chunk within 4096 and loses nothing', () => {
  const text = ('line of text\n').repeat(1000);
  const chunks = splitText(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 4096));
  assert.equal(chunks.join('\n').replace(/\n/g, ''), text.replace(/\n/g, ''));
});

test('sendNotification pings the configured roles and sends long bodies in several messages', async () => {
  const sent = [];
  const channel = { send: async (m) => { sent.push(m); return { id: String(sent.length) }; } };
  const first = await sendNotification(channel, { color: 1, description: 'x'.repeat(9000) }, { pingRoleIds: ['42', '43'] });
  assert.equal(first.id, '1');
  assert.equal(sent.length, 3);
  assert.equal(sent[0].content, '<@&42> <@&43>');
  assert.deepEqual(sent[0].allowedMentions, { roles: ['42', '43'] });
  assert.equal(sent[1].content, undefined);
});

test('sendNotification sends a short embed unchanged with no ping when unset', async () => {
  const sent = [];
  const channel = { send: async (m) => { sent.push(m); return { id: '1' }; } };
  await sendNotification(channel, { description: 'hi' }, {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, undefined);
});

test('sendNotification sends no ping for an empty role list', async () => {
  const sent = [];
  const channel = { send: async (m) => { sent.push(m); return { id: '1' }; } };
  await sendNotification(channel, { description: 'hi' }, { pingRoleIds: [] });
  assert.equal(sent[0].content, undefined);
  assert.equal(sent[0].allowedMentions, undefined);
});

test('sendNotification skips roles that no longer exist in the guild', async () => {
  const sent = [];
  const channel = {
    guild: { roles: { cache: new Map([['42', {}]]) } },
    send: async (m) => { sent.push(m); return { id: '1' }; },
  };
  await sendNotification(channel, { description: 'hi' }, { pingRoleIds: ['42', 'gone'] });
  assert.equal(sent[0].content, '<@&42>');
  assert.deepEqual(sent[0].allowedMentions, { roles: ['42'] });

  sent.length = 0;
  await sendNotification(channel, { description: 'hi' }, { pingRoleIds: ['gone'] });
  assert.equal(sent[0].content, undefined, 'no ping when every role is gone');
});
