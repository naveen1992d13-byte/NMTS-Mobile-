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
  return {
    ...payload,
    type: 'branch_request',
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

export function addNativeSnoozeListener(listener) {
  return NativeRequestAlert?.addListener?.('onSnooze', (payload) => {
    listener(toRequestAlertData(payload || {}));
  });
}

export async function isIgnoringBatteryOptimizations() {
  if (!NativeRequestAlert?.isIgnoringBatteryOptimizations) return true;
  return NativeRequestAlert.isIgnoringBatteryOptimizations();
}

export async function requestIgnoreBatteryOptimizations() {
  if (!NativeRequestAlert?.requestIgnoreBatteryOptimizations) return false;
  return NativeRequestAlert.requestIgnoreBatteryOptimizations();
}
