export const ANDROID_CHANNEL_ID = 'sleeping-stock-requests-v2';
export const ANDROID_SOUND_NAME = 'nmts-request-ring';
export const REQUEST_CATEGORY_ID = 'branch-request';
export const ACTION_OPEN_REQUEST = 'OPEN_REQUEST';
export const ACTION_SNOOZE = 'SNOOZE';
export const DEFAULT_NOTIFICATION_ACTION = 'expo.modules.notifications.actions.DEFAULT';

export function isBranchRequest(data) {
  if (!data || typeof data !== 'object') return false;
  return (
    data.type === 'branch_request' ||
    data.screen === 'request' ||
    Boolean(data.request_group_key) ||
    Boolean(data.request_number)
  );
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
  return {
    request_group_key: payload.request_group_key || row.request_group_key || '',
    request_number: payload.request_number || row.request_number || '—',
    from_dealer: payload.requesting_dealer || row.requesting_dealer || '—',
    from_branch: payload.requesting_branch || row.requesting_branch || '—',
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

export function shouldOpenExactRequest(actionIdentifier) {
  const id = String(actionIdentifier || '');
  if (isSnoozeAction(id)) return false;
  return (
    !id ||
    id === DEFAULT_NOTIFICATION_ACTION ||
    id === ACTION_OPEN_REQUEST ||
    id.endsWith(ACTION_OPEN_REQUEST)
  );
}

export const PUSH_SOUND_ASSET = './assets/nmts-request-ring.wav';
export const PUSH_LOGO_ASSET = './assets/sleeping-stock-logo.png';
export const PUSH_ICON_ASSET = './assets/icon.png';
