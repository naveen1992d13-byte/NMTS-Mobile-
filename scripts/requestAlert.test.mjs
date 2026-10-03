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
  canCompleteRequest,
  canEditRequest,
  canPickRequest,
  canTransferRequest,
  findRequestGroup,
  flattenExpoNotificationData,
  formatSlaRemaining,
  isBranchRequest,
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

const expoEnvelope = {
  title: 'RQ-9',
  message: 'New branch request',
  experienceId: '@naveensleep/sleeping-stock-mobile',
  body: JSON.stringify({
    type: 'branch_request',
    request_group_key: 'g-nested',
    request_number: 'RQ-9',
    requesting_branch: 'North Branch',
    total_items: 3,
    total_qty: 12,
    value: 4500,
  }),
};
const expoFlat = flattenExpoNotificationData(expoEnvelope);
assert.equal(expoFlat.type, 'branch_request');
assert.equal(expoFlat.request_group_key, 'g-nested');
assert.equal(expoFlat.requesting_branch, 'North Branch');
assert.equal(expoFlat.total_items, '3');
assert.equal(expoFlat.total_qty, '12');
assert.equal(isBranchRequest(expoEnvelope), true);

const nestedDataEnvelope = {
  title: 'RQ-10',
  message: 'Reminder',
  body: JSON.stringify({
    data: {
      type: 'branch_request',
      request_group_key: 'g-data',
      request_number: 'RQ-10',
      requesting_branch: 'South Branch',
      total_items: 1,
      total_qty: 2,
    },
  }),
};
assert.equal(flattenExpoNotificationData(nestedDataEnvelope).type, 'branch_request');
assert.equal(flattenExpoNotificationData(nestedDataEnvelope).request_group_key, 'g-data');
assert.equal(isBranchRequest(nestedDataEnvelope), true);

assert.equal(isBranchRequest({ title: 'Hello', message: 'Ordinary notice' }), false);
assert.equal(isBranchRequest({ title: 'Hello', message: 'Ordinary notice', body: 'Please open the app' }), false);
assert.equal(isBranchRequest({ type: 'auto_perpetual', request_group_key: 'g1' }), false);
assert.equal(isBranchRequest({
  title: 'Task',
  body: JSON.stringify({ type: 'auto_perpetual', request_group_key: 'g1' }),
}), false);
assert.equal(isBranchRequest({ type: 'branch_request', request_group_key: 'g1' }), true);
assert.equal(isBranchRequest({ request_group_key: 'g1', request_number: 'RQ-1' }), false);

const pending = { status: 'pending', accepted_by_me: false, can_edit: false };
assert.equal(canPickRequest(pending), true);
assert.equal(canEditRequest(pending), false);
assert.equal(canCompleteRequest(pending), false);
assert.equal(canTransferRequest(pending), false);

const pickedByOther = { status: 'picked', accepted_by_me: false, can_edit: false };
assert.equal(canPickRequest(pickedByOther), false);
assert.equal(canEditRequest(pickedByOther), false);
assert.equal(canTransferRequest(pickedByOther), false);

const mine = { status: 'picked', accepted_by_me: true, can_edit: true, all_lines_answered: false };
assert.equal(canPickRequest(mine), false);
assert.equal(canEditRequest(mine), true);
assert.equal(canCompleteRequest(mine), false);
assert.equal(canTransferRequest(mine), true);

const answered = { ...mine, all_lines_answered: true };
assert.equal(canCompleteRequest(answered), true);
assert.equal(canTransferRequest(answered), true);

const transferredAway = { status: 'picked', accepted_by_me: false, can_edit: false, all_lines_answered: true };
assert.equal(canEditRequest(transferredAway), false);
assert.equal(canCompleteRequest(transferredAway), false);
assert.equal(canTransferRequest(transferredAway), false);

console.log('requestAlert routing tests: PASS');
