import { requireOptionalNativeModule } from 'expo-modules-core';

const NativeRequestAlert = requireOptionalNativeModule('NativeRequestAlert');

export function toRequestAlertData(payload = {}) {
  const requestId = String(payload.requestId || payload.request_group_key || '');
  const requestNumber = String(payload.requestNumber || payload.request_number || '');
  const branchName = String(
    payload.branchName || payload.requesting_branch || payload.requested_branch || ''
  );
  const totalItems = payload.totalItems ?? payload.total_items ?? 0;
  const totalQuantity =
    payload.totalQuantity ?? payload.total_quantity ?? payload.total_qty ?? 0;
  const ringDeadlineAt = String(payload.ringDeadlineAt || payload.ring_deadline_at || '');
  const ringTtlSeconds = String(
    payload.ringTtlSeconds ?? payload.ring_ttl_seconds ?? '50'
  );
  return {
    ...payload,
    type: payload.type || 'branch_request',
    screen: 'request',
    requestId,
    request_group_key: requestId || payload.request_group_key,
    requestNumber,
    request_number: requestNumber,
    branchName,
    requesting_branch: branchName,
    requested_branch: branchName,
    totalItems,
    total_items: totalItems,
    totalQuantity,
    total_qty: totalQuantity,
    total_quantity: totalQuantity,
    round: payload.round,
    ringDeadlineAt,
    ring_deadline_at: ringDeadlineAt,
    ringTtlSeconds,
    ring_ttl_seconds: ringTtlSeconds,
  };
}

export function stopRinging(requestId) {
  NativeRequestAlert?.stopRinging?.(String(requestId || ''));
}

export function addNativePickListener(listener) {
  return NativeRequestAlert?.addListener?.('onPick', (payload) => {
    listener(toRequestAlertData(payload || {}));
  });
}

export function addNativeRejectListener(listener) {
  return NativeRequestAlert?.addListener?.('onReject', (payload) => {
    listener(toRequestAlertData(payload || {}));
  });
}

/** @deprecated Snooze removed — no-op. Use addNativeRejectListener. */
export function addNativeSnoozeListener(_listener) {
  return { remove() {} };
}

export default NativeRequestAlert;
