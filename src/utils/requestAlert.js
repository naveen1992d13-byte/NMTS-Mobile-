export const ANDROID_CHANNEL_ID = 'sleeping-stock-requests-v3';
export const ANDROID_LEGACY_CHANNEL_ID = 'sleeping-stock-requests';
export const ANDROID_CHANNEL_IDS = [ANDROID_CHANNEL_ID, ANDROID_LEGACY_CHANNEL_ID];
export const ANDROID_SOUND_FILE = 'sleeping_stock_alert_2_rising_dispatch.wav';
export const ANDROID_SOUND_NAME = ANDROID_SOUND_FILE;
export const REQUEST_CATEGORY_ID = 'branch-request';
export const ACTION_PICK_REQUEST = 'PICK';
export const ACTION_OPEN_REQUEST = 'OPEN_REQUEST';
export const ACTION_SNOOZE = 'SNOOZE';
export const DEFAULT_NOTIFICATION_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function stringifyField(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  return '';
}

function mergePlainObject(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return;
  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (key === 'data') mergePlainObject(target, value);
      return;
    }
    const text = stringifyField(value);
    if (text) target[key] = text;
  });
}

/**
 * Expo SDK 54 puts website custom fields in RemoteMessage.data["body"] as a
 * JSON string (NotificationData.body). Flatten that JSON and a nested "data"
 * object so classification can see type=branch_request and request fields.
 */
export function flattenExpoNotificationData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const flat = {};
  Object.entries(data).forEach(([key, value]) => {
    const text = stringifyField(value);
    if (text) flat[key] = text;
  });
  let bodyObj = null;
  const rawBody = data.body;
  if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    bodyObj = rawBody;
  } else if (typeof rawBody === 'string' && rawBody.trim().startsWith('{')) {
    try {
      bodyObj = JSON.parse(rawBody);
    } catch (_error) {
      bodyObj = null;
    }
  }
  if (bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj)) {
    mergePlainObject(flat, bodyObj);
    if (bodyObj.data && typeof bodyObj.data === 'object' && !Array.isArray(bodyObj.data)) {
      mergePlainObject(flat, bodyObj.data);
    }
  }
  return flat;
}

export function resolveNotificationData(data) {
  return flattenExpoNotificationData(data);
}

export function isBranchRequest(data) {
  const flat = flattenExpoNotificationData(data);
  if (flat.type === 'auto_perpetual') return false;
  return flat.type === 'branch_request';
}

export function formatSlaRemaining(deadlineOrSeconds, nowMs = Date.now()) {
  if (deadlineOrSeconds == null || deadlineOrSeconds === '') return '—';
  let seconds;
  if (typeof deadlineOrSeconds === 'number' && Number.isFinite(deadlineOrSeconds)) {
    seconds = deadlineOrSeconds;
  } else {
    const parsed = Date.parse(String(deadlineOrSeconds));
    if (Number.isNaN(parsed)) {
      const asNum = Number(deadlineOrSeconds);
      if (!Number.isFinite(asNum)) return '—';
      seconds = asNum;
    } else {
      seconds = Math.floor((parsed - nowMs) / 1000);
    }
  }
  seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function findRequestGroup(rows, data) {
  const key = String(data?.request_group_key || '').trim();
  const number = String(data?.request_number || '').trim();
  return (rows || []).find((row) => {
    const rowKey = String(row?.request_group_key || '').trim();
    const rowNumber = String(row?.request_number || '').trim();
    return (key && (rowKey === key || rowNumber === key)) || (number && (rowNumber === number || rowKey === number));
  }) || null;
}

export function buildIncomingAlert(data, session, group) {
  const payload = data || {};
  const row = group || {};
  const requestedBranch =
    payload.requesting_branch ||
    payload.requested_branch ||
    row.requesting_branch ||
    '—';
  return {
    request_group_key: payload.request_group_key || row.request_group_key || '',
    request_number: payload.request_number || row.request_number || '—',
    requested_branch: requestedBranch,
    from_dealer: payload.requesting_dealer || row.requesting_dealer || '—',
    from_branch: requestedBranch,
    to_dealer: payload.supplying_dealer || row.supplying_dealer || session?.dealerName || '—',
    to_branch: payload.supplying_branch || row.supplying_branch || session?.branch || '—',
    total_items: payload.total_items ?? row.total_items ?? 0,
    total_qty: payload.total_qty ?? payload.total_quantity ?? row.total_quantity ?? 0,
    sla_label: formatSlaRemaining(
      payload.sla_remaining_seconds ?? payload.response_deadline ?? row.response_deadline
    ),
    group: row,
    data: payload,
  };
}

export function isSnoozeAction(actionIdentifier) {
  const id = String(actionIdentifier || '');
  return id === ACTION_SNOOZE || id.endsWith(ACTION_SNOOZE);
}

export function isPickAction(actionIdentifier) {
  const id = String(actionIdentifier || '');
  if (isSnoozeAction(id)) return false;
  return (
    id === ACTION_PICK_REQUEST ||
    id.endsWith(ACTION_PICK_REQUEST) ||
    id === ACTION_OPEN_REQUEST ||
    id.endsWith(ACTION_OPEN_REQUEST)
  );
}

export function shouldOpenExactRequest(actionIdentifier) {
  return isPickAction(actionIdentifier);
}

export const PUSH_SOUND_ASSET = './assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav';
export const PUSH_LOGO_ASSET = './assets/sleeping-stock-logo.png';
export const PUSH_ICON_ASSET = './assets/icon.png';
