import assert from 'node:assert/strict';
import {
  ACTION_OPEN_REQUEST,
  ACTION_PICK_REQUEST,
  ACTION_SNOOZE,
  ANDROID_CHANNEL_ID,
  ANDROID_LEGACY_CHANNEL_ID,
  ANDROID_SOUND_NAME,
  DEFAULT_NOTIFICATION_ACTION,
  PUSH_SOUND_ASSET,
  buildIncomingAlert,
  findRequestGroup,
  formatSlaRemaining,
  isPickAction,
  isSnoozeAction,
  shouldOpenExactRequest,
} from '../src/utils/requestAlert.js';

assert.equal(ANDROID_SOUND_NAME, 'sleeping_stock_alert_2_rising_dispatch.wav');
assert.equal(ANDROID_CHANNEL_ID, 'sleeping-stock-requests-v3');
assert.equal(ANDROID_LEGACY_CHANNEL_ID, 'sleeping-stock-requests');
assert.equal(PUSH_SOUND_ASSET, './assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav');

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

assert.equal(shouldOpenExactRequest(DEFAULT_NOTIFICATION_ACTION), false);
assert.equal(isPickAction(ACTION_PICK_REQUEST), true);
assert.equal(isPickAction(ACTION_OPEN_REQUEST), true);
assert.equal(isPickAction(ACTION_SNOOZE), false);
assert.equal(isSnoozeAction(ACTION_SNOOZE), true);

const alert = buildIncomingAlert(
  { request_group_key: 'abc', request_number: 'RQ-1', sla_remaining_seconds: 40 },
  { dealerName: 'To D', branch: 'To B' },
  rows[0]
);
assert.equal(alert.requested_branch, 'From B');
assert.equal(alert.request_number, 'RQ-1');
assert.equal(alert.total_items, 2);
assert.equal(alert.total_qty, 5);

console.log('requestAlert routing tests: PASS');
