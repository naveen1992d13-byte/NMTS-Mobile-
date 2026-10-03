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

export function isRequestPickedPush(data) {
  return flattenExpoNotificationData(data).type === 'request_picked';
}

export function isRequestTransferredPush(data) {
  return flattenExpoNotificationData(data).type === 'request_transferred';
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
  const key = String(data?.request_group_key || data?.requestId || data?.request_id || '').trim();
  const number = String(data?.request_number || data?.requestNumber || '').trim();
  return (rows || []).find((row) => {
    const rowKey = String(row?.request_group_key || '').trim();
    const rowId = String(row?.request_group_id || '').trim();
    const rowNumber = String(row?.request_number || '').trim();
    return (
      (key && (rowKey === key || rowId === key || rowNumber === key)) ||
      (number && (rowNumber === number || rowKey === number || rowId === number))
    );
  }) || null;
}

export function asOwnedPickedRequest(row, extra = {}) {
  const base = row && typeof row === 'object' ? row : {};
  return {
    ...base,
    ...extra,
    status: 'picked',
    status_label: 'PICKED',
    accepted_by_me: true,
    accepted_by_another: false,
    can_edit: true,
    can_pick: false,
    can_snooze: false,
    can_transfer: true,
    can_release: true,
  };
}

export function buildIncomingAlert(data, session, group) {
  const payload = data || {};
  const row = group || {};
  const requestedBranch =
    payload.requesting_branch ||
    payload.requested_branch ||
    row.requesting_branch ||
    '—';
  const status = String(row.status || payload.status || 'pending').toLowerCase();
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
    status,
    status_label: row.status_label || statusLabelFor(status),
    picked_by_name: row.picked_by_name || row.accepted_by_device_user_name || '',
    skip_allowed: row.can_snooze != null ? Boolean(row.can_snooze) : row.skip_allowed !== false && status === 'pending',
    can_pick: row.can_pick != null ? Boolean(row.can_pick) : status === 'pending',
    can_snooze: row.can_snooze != null ? Boolean(row.can_snooze) : row.skip_allowed !== false && status === 'pending',
    can_edit: row.can_edit != null ? Boolean(row.can_edit) : Boolean(row.accepted_by_me) && status === 'picked',
    accepted_by_me: Boolean(row.accepted_by_me),
    type: payload.type || 'branch_request',
    group: row,
    data: payload,
  };
}

export function requestStatus(row) {
  return String(row?.status || 'pending').toLowerCase();
}

export function statusLabelFor(status) {
  const key = String(status || 'pending').toLowerCase();
  if (key === 'picked') return 'PICKED';
  if (key === 'accepted') return 'ACCEPTED';
  if (key === 'picking_completed') return 'PICKING COMPLETED';
  if (key === 'rejected') return 'REJECTED';
  if (key === 'expired') return 'EXPIRED – NO RESPONSE';
  if (key === 'pending') return 'NEW';
  return 'REQUEST';
}

export function ownerName(row) {
  return (
    row?.picked_by_name ||
    row?.accepted_by_name ||
    row?.rejected_by_name ||
    row?.accepted_by_device_user_name ||
    ''
  );
}

export function canPickRequest(row) {
  if (row?.can_pick != null) return Boolean(row.can_pick);
  return requestStatus(row) === 'pending' && !row?.accepted_by_another;
}

export function canEditRequest(row) {
  if (row?.can_edit != null) return Boolean(row.can_edit);
  return Boolean(row?.accepted_by_me) && requestStatus(row) === 'picked';
}

export function canSnoozeRequest(row) {
  if (row?.can_snooze != null) return Boolean(row.can_snooze);
  const skipCount = Number(row?.my_skip_count || 0);
  return requestStatus(row) === 'pending' && skipCount < 2;
}

export function canCompleteRequest(row) {
  if (row?.can_complete != null) return Boolean(row.can_complete);
  return canEditRequest(row) && Boolean(row?.all_lines_answered);
}

export function canTransferRequest(row) {
  if (row?.can_transfer != null) return Boolean(row.can_transfer);
  return canEditRequest(row);
}

export function canReleaseRequest(row) {
  if (row?.can_release != null) return Boolean(row.can_release);
  return canEditRequest(row);
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
