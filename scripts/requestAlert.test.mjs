import assert from 'node:assert/strict';
import {
  ACTION_OPEN_REQUEST,
  ACTION_SNOOZE,
  DEFAULT_NOTIFICATION_ACTION,
  buildIncomingAlert,
  findRequestGroup,
  formatSlaRemaining,
  isSnoozeAction,
  shouldOpenExactRequest,
} from '../src/utils/requestAlert.js';

const now = Date.parse('2026-09-11T12:00:00.000Z');
assert.equal(formatSlaRemaining(90, now), '1m 30s');
assert.equal(formatSlaRemaining('2026-09-11T12:45:00.000Z', now), '45m 0s');
assert.equal(formatSlaRemaining(null, now), '—');

const rows = [
  { request_group_key: 'abc', request_number: 'RQ-1', requesting_dealer: 'From D', requesting_branch: 'From B', total_items: 2, total_quantity: 5 },
];
assert.equal(findRequestGroup(rows, { request_group_key: 'abc' }).request_number, 'RQ-1');
assert.equal(findRequestGroup(rows, { request_number: 'RQ-1' }).request_group_key, 'abc');
assert.equal(findRequestGroup(rows, { request_group_key: 'nope' }), null);

assert.equal(shouldOpenExactRequest(DEFAULT_NOTIFICATION_ACTION), true);
assert.equal(shouldOpenExactRequest(ACTION_OPEN_REQUEST), true);
assert.equal(shouldOpenExactRequest(ACTION_SNOOZE), false);
assert.equal(isSnoozeAction(ACTION_SNOOZE), true);

const alert = buildIncomingAlert(
  { request_group_key: 'abc', request_number: 'RQ-1', sla_remaining_seconds: 40 },
  { dealerName: 'To D', branch: 'To B' },
  rows[0]
);
assert.equal(alert.from_dealer, 'From D');
assert.equal(alert.to_dealer, 'To D');
assert.equal(alert.to_branch, 'To B');
assert.equal(alert.sla_label, '40s');

console.log('requestAlert routing tests: PASS');
