const test = require('node:test');
const assert = require('node:assert/strict');

const { getDefaultActionsForEvent } = require('../src/functions/eventRouting');

test('getDefaultActionsForEvent returns expected defaults for known events', () => {
  assert.deepEqual(getDefaultActionsForEvent('issues'), {
    opened: true,
    closed: true,
    reopened: true,
    edited: true,
    labeled: true,
    assigned: true,
    comments: false
  });

  assert.deepEqual(getDefaultActionsForEvent('workflow_job'), {
    queued: false,
    in_progress: false,
    completed: true,
    waiting: false
  });

  assert.deepEqual(getDefaultActionsForEvent('check_run'), {
    created: false,
    requested: false,
    rerequested: false,
    completed: true
  });
});

test('getDefaultActionsForEvent returns empty config for unknown events', () => {
  assert.deepEqual(getDefaultActionsForEvent('unknown_event'), {});
});
