const test = require('node:test');
const assert = require('node:assert/strict');

const { stripHtmlComments } = require('../src/functions/sanitizeBody');

test('stripHtmlComments removes a single HTML comment', () => {
  assert.equal(
    stripHtmlComments('<!-- hidden hint -->actual body'),
    'actual body'
  );
});

test('stripHtmlComments removes multiple HTML comments', () => {
  const input = '<!-- a -->one<!-- b -->two<!-- c -->';
  assert.equal(stripHtmlComments(input), 'onetwo');
});

test('stripHtmlComments removes multi-line HTML comments (typical issue template)', () => {
  const input = [
    '<!--',
    '  Please describe the bug you are experiencing.',
    '  Include steps to reproduce.',
    '-->',
    '',
    'The app crashes when I click Save.'
  ].join('\n');

  assert.equal(stripHtmlComments(input), 'The app crashes when I click Save.');
});

test('stripHtmlComments trims surrounding whitespace left behind', () => {
  const input = '\n\n<!-- remove me -->\n\nHello\n\n';
  assert.equal(stripHtmlComments(input), 'Hello');
});

test('stripHtmlComments returns empty string when the body is only a comment', () => {
  assert.equal(stripHtmlComments('<!-- only comment -->'), '');
  assert.equal(stripHtmlComments('   <!-- a -->\n<!-- b -->   '), '');
});

test('stripHtmlComments leaves bodies without comments unchanged (aside from trim)', () => {
  assert.equal(stripHtmlComments('No comments here.'), 'No comments here.');
  assert.equal(stripHtmlComments('  padded  '), 'padded');
});

test('stripHtmlComments is non-greedy across adjacent comments', () => {
  const input = '<!-- first -->keep<!-- second -->';
  assert.equal(stripHtmlComments(input), 'keep');
});

test('stripHtmlComments preserves markdown and code fences that are not comments', () => {
  const input = '# Title\n\n```js\nconst x = 1; // not an html comment\n```';
  assert.equal(stripHtmlComments(input), input);
});

test('stripHtmlComments handles non-string input defensively', () => {
  assert.equal(stripHtmlComments(undefined), '');
  assert.equal(stripHtmlComments(null), '');
  assert.equal(stripHtmlComments(123), '');
});
