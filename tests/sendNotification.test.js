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
  const { message, sentCount } = await sendNotification(channel, { color: 1, description: 'x'.repeat(9000) }, { pingRoleIds: ['42', '43'] });
  assert.equal(message.id, '1');
  assert.equal(sentCount, 3);
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

test('splitText never cuts an emoji in half at the 4096 boundary', () => {
  const text = 'a'.repeat(4095) + '🚀' + 'b'.repeat(10); // 🚀 spans positions 4095-4096
  const chunks = splitText(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every(c => c.length <= 4096));
  assert.ok(chunks.every(c => c.isWellFormed()), 'no lone surrogates');
  assert.equal(chunks[0], 'a'.repeat(4095));
  assert.ok(chunks[1].startsWith('🚀'));
  assert.equal(chunks.join(''), text);
});

test('splitText keeps emoji intact for many boundary positions', () => {
  for (let offset = 0; offset < 8; offset++) {
    const text = 'a'.repeat(offset) + '🚀'.repeat(3000);
    const chunks = splitText(text);
    assert.ok(chunks.every(c => c.isWellFormed() && c.length <= 4096), `offset ${offset}`);
    assert.equal(chunks.join(''), text);
  }
});

test('sendNotification counts only messages actually sent when a continuation fails', async () => {
  const sent = [];
  let calls = 0;
  const channel = { send: async (m) => { calls += 1; if (calls === 3) { throw new Error('rate limited'); } sent.push(m); return { id: String(calls) }; } };
  const { message, sentCount } = await sendNotification(channel, { description: 'x'.repeat(13000) }, {});
  assert.equal(message.id, '1');
  assert.equal(sentCount, 2, 'first + one continuation, then stopped');
  assert.equal(calls, 3, 'stops after the failure');
});

test('sendNotification throws if the first message fails', async () => {
  const channel = { send: async () => { throw new Error('missing access'); } };
  await assert.rejects(sendNotification(channel, { description: 'x'.repeat(9000) }, {}), /missing access/);
});
