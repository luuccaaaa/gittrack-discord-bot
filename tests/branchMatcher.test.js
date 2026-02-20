const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesBranchPattern,
  findMatchingBranches,
  isValidBranchPattern,
  describeBranchPattern
} = require('../src/functions/branchMatcher');

test('matchesBranchPattern supports wildcard, exact, prefix, and negation', () => {
  assert.equal(matchesBranchPattern('main', '*'), true);
  assert.equal(matchesBranchPattern('main', 'main'), true);
  assert.equal(matchesBranchPattern('develop', 'main'), false);

  assert.equal(matchesBranchPattern('feature/auth', 'feature/*'), true);
  assert.equal(matchesBranchPattern('feature', 'feature/*'), false);

  assert.equal(matchesBranchPattern('main', '!main'), false);
  assert.equal(matchesBranchPattern('develop', '!main'), true);

  assert.equal(matchesBranchPattern('release/v1.0', '!release/*'), false);
  assert.equal(matchesBranchPattern('hotfix/v1.0.1', '!release/*'), true);
});

test('findMatchingBranches returns all matching branch patterns', () => {
  const trackedBranches = [
    { branchName: '*' },
    { branchName: 'main' },
    { branchName: 'feature/*' },
    { branchName: '!release/*' }
  ];

  const matches = findMatchingBranches(trackedBranches, 'feature/new-ui');
  const names = matches.map((entry) => entry.branchName);

  assert.deepEqual(names.sort(), ['*', '!release/*', 'feature/*'].sort());
});

test('isValidBranchPattern validates expected supported formats', () => {
  assert.equal(isValidBranchPattern('*'), true);
  assert.equal(isValidBranchPattern('main'), true);
  assert.equal(isValidBranchPattern('release/*'), true);
  assert.equal(isValidBranchPattern('!main'), true);
  assert.equal(isValidBranchPattern('!release/*'), true);

  assert.equal(isValidBranchPattern('!*'), false);
  assert.equal(isValidBranchPattern('feature/*/docs'), false);
  assert.equal(isValidBranchPattern('*main*'), false);
});

test('describeBranchPattern renders human-readable descriptions', () => {
  assert.equal(describeBranchPattern('*'), 'All branches');
  assert.equal(describeBranchPattern('main'), 'Branch "main"');
  assert.equal(describeBranchPattern('release/*'), 'Branches starting with "release/"');
  assert.equal(describeBranchPattern('!main'), 'All branches except "main"');
});
