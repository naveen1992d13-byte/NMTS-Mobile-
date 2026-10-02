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
  const type = String(payload.type || 'branch_request');
  return {
    ...payload,
    type,
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
    picked_by_name: payload.pickedByName || payload.picked_by_name || '',
  };
}

export function stopRinging(requestId) {
  NativeRequestAlert?.stopRinging?.(String(requestId || ''));
}

export function saveNativeAuth(token, baseUrl) {
  NativeRequestAlert?.saveAuth?.(String(token || ''), String(baseUrl || ''));
}

export function clearNativeAuth() {
  NativeRequestAlert?.clearAuth?.();
}

export async function isIgnoringBatteryOptimizations() {
  try {
    const result = await NativeRequestAlert?.isIgnoringBatteryOptimizations?.();
    return result ?? true;
  } catch (_e) {
    return true;
  }
}

export function requestIgnoreBatteryOptimizations() {
  NativeRequestAlert?.requestIgnoreBatteryOptimizations?.();
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

export function addNativeIncomingAlertListener(listener) {
  return NativeRequestAlert?.addListener?.('onIncomingAlert', (payload) => {
    listener(toRequestAlertData(payload || {}));
  });
}

export function addNativeRequestPickedListener(listener) {
  return NativeRequestAlert?.addListener?.('onRequestPicked', (payload) => {
    listener(toRequestAlertData(payload || {}));
  });
}

export async function canUseFullScreenIntent() {
  try {
    const result = await NativeRequestAlert?.canUseFullScreenIntent?.();
    return result ?? true;
  } catch (_e) {
    return true;
  }
}

export function requestUseFullScreenIntent() {
  NativeRequestAlert?.requestUseFullScreenIntent?.();
}
