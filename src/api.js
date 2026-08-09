import axios from 'axios';

import { API_BASE_URL, REQUEST_TIMEOUT_MS, normalizeApiBaseUrl } from './config/env';
import { getSession, getSessionToken, clearSession } from './services/session';

let onSessionInvalidated = null;
let cachedAuth = { token: null, baseUrl: null, loadedAt: 0 };
const AUTH_CACHE_TTL_MS = 15000;

export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'server', data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.data = data;
  }
}

export function setOnSessionInvalidated(callback) {
  onSessionInvalidated = typeof callback === 'function' ? callback : null;
}

export function clearApiAuthCache() {
  cachedAuth = { token: null, baseUrl: null, loadedAt: 0 };
}

async function resolveAuthContext(overrideUrl) {
  const now = Date.now();
  if (
    !overrideUrl &&
    cachedAuth.token &&
    cachedAuth.baseUrl &&
    now - cachedAuth.loadedAt < AUTH_CACHE_TTL_MS
  ) {
    return cachedAuth;
  }

  const session = await getSession();
  const baseUrl = normalizeApiBaseUrl(overrideUrl || session?.apiBaseUrl || API_BASE_URL);
  const token = overrideUrl ? null : (session?.sessionToken || (await getSessionToken()));
  if (!overrideUrl) {
    cachedAuth = { token, baseUrl, loadedAt: now };
  }
  return { token, baseUrl };
}

function errorFromAxios(error) {
  if (error instanceof ApiError) return error;
  const status = error?.response?.status || 0;
  const detail = error?.response?.data?.detail;
  const message = typeof detail === 'string' ? detail : detail?.message || error?.message || 'Unable to connect to the NMTS server.';
  let kind = 'server';
  if (status === 401 || status === 403) kind = 'auth';
  else if (!status) kind = error?.code === 'ECONNABORTED' ? 'timeout' : 'network';
  return new ApiError(message, { status, kind, data: error?.response?.data || null });
}

async function request(method, path, { data, params, auth = true, baseUrl, timeout = REQUEST_TIMEOUT_MS } = {}) {
  try {
    const resolved = await resolveAuthContext(baseUrl);
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = resolved.token;
      if (!token) throw new ApiError('Device session not found. Please pair this device again.', { status: 401, kind: 'auth' });
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await axios({
      method,
      url: `${resolved.baseUrl}${path}`,
      data,
      params,
      headers,
      timeout,
    });
    return response.data;
  } catch (rawError) {
    const error = errorFromAxios(rawError);
    if (auth && (error.status === 401 || error.status === 403)) {
      clearApiAuthCache();
      await clearSession();
      if (onSessionInvalidated) onSessionInvalidated(error);
    }
    throw error;
  }
}

export const verifyPairing = ({ mobileUserId, pairingType, pairingCode, pairingToken, deviceUserName, deviceUserMobile, deviceName, deviceInfo, appVersion, pushToken, apiBaseUrl }) =>
  request('post', '/mobile/pairing/verify', {
    auth: false,
    baseUrl: apiBaseUrl,
    data: {
      mobile_user_id: mobileUserId || null,
      pairing_type: pairingType || null,
      pairing_code: pairingCode,
      pairing_token: pairingToken || null,
      device_user_name: deviceUserName,
      device_user_mobile: deviceUserMobile,
      device_name: deviceName,
      device_info: deviceInfo,
      app_version: appVersion,
      push_token: pushToken,
    },
  });

export const validateSession = () => request('get', '/mobile/session/validate');
export const registerPushToken = (pushToken) => request('put', '/mobile/devices/push-token', { data: { push_token: pushToken } });
export const getNotifications = () => request('get', '/mobile/notifications');
export const acceptNotification = (requestGroupKey) => request('post', '/mobile/notifications/accept', { data: { request_group_key: requestGroupKey } });
export const skipNotification = (requestGroupKey) => request('post', '/mobile/notifications/skip', { data: { request_group_key: requestGroupKey } });
export const submitPartResponse = (requestGroupKey, parts) => request('post', '/mobile/notifications/respond', {
  data: {
    request_group_key: requestGroupKey,
    parts: parts.map((part) => ({
      order_request_id: part.orderRequestId ?? part.order_request_id,
      part_number: part.partNumber ?? part.part_number,
      accepted_qty: part.acceptedQty ?? part.accepted_qty,
      remark: part.remark || '',
    })),
  },
});

/**
 * Submit one stock verification record.
 * Preserves verification_type + damage_qty end-to-end for offline queue sync.
 */
export const submitStockVerification = ({
  partNumber,
  partName,
  physicalQty,
  location,
  remark,
  entryMethod,
  clientId,
  verificationSessionId,
  isNewPart,
  verificationType = 'physical',
  damageQty = 0,
}) => request('post', '/mobile/stock-verification', {
  data: {
    part_number: partNumber,
    part_name: partName || '',
    physical_qty: physicalQty,
    location,
    remark,
    entry_method: entryMethod,
    client_id: clientId,
    verification_session_id: verificationSessionId || undefined,
    is_new_part: Boolean(isNewPart),
    verification_type: verificationType || 'physical',
    damage_qty: Number(damageQty || 0),
  },
});

/**
 * Preferred bulk path when the backend exposes it.
 * Contract (see BACKEND_API_CONTRACT.md):
 * POST /mobile/stock-verification/batch
 * { items: [StockVerificationSubmit, ...] }
 * → { results: [{ client_id, success, ... }], synced, failed }
 */
export const submitStockVerificationBatch = (items) => request('post', '/mobile/stock-verification/batch', {
  data: {
    items: (items || []).map((item) => ({
      part_number: item.partNumber,
      part_name: item.partName || '',
      physical_qty: item.physicalQty,
      location: item.location,
      remark: item.remark,
      entry_method: item.entryMethod,
      client_id: item.clientId,
      verification_session_id: item.verificationSessionId || undefined,
      is_new_part: Boolean(item.isNewPart),
      verification_type: item.verificationType || 'physical',
      damage_qty: Number(item.damageQty || 0),
    })),
  },
  timeout: Math.max(REQUEST_TIMEOUT_MS, 45000),
});

export const getAutoPerpetualTasks = () => request('get', '/mobile/auto-perpetual/tasks');
export const getAutoPerpetualSessionToday = () => request('get', '/mobile/auto-perpetual/session/today');
export const getStockVerificationHistory = (options = {}) => request('get', '/mobile/stock-verification/history', {
  params: typeof options === 'string' ? { part_number: options } : { ...(options.partNumber ? { part_number: options.partNumber } : {}), ...(options.limit ? { limit: options.limit } : {}) },
});

/**
 * Stock search.
 * - mode 'prefix' (Product Hub style): GET ?q=26300&mode=prefix
 * - mode 'exact' (multi part): GET ?part_numbers=A\nB\nC
 * Falls back to exact part_numbers when prefix endpoint is unavailable (404/422).
 */
export async function searchStock(query, options = {}) {
  const mode = options.mode || 'exact';
  if (mode === 'prefix') {
    const q = Array.isArray(query) ? String(query[0] || '') : String(query || '');
    const needle = q.trim();
    // Always request prefix mode. Do not fall back to exact part_numbers for a
    // short prefix — that incorrectly reports "Not Found: 26300" when matches exist.
    return request('get', '/mobile/stock-search', {
      params: { q: needle, mode: 'prefix', limit: options.limit || 100 },
    });
  }

  const partNumbers = Array.isArray(query) ? query.join('\n') : query;
  return request('get', '/mobile/stock-search', {
    params: { part_numbers: partNumbers },
  });
}

export const getLatestAppVersion = () => request('get', '/mobile/app-versions/latest', { auth: false });
