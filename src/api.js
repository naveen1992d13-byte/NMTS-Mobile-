// Sleeping Stock Mobile — API client.
//
// Every function here talks to the /api/mobile/* backend added in
// backend/mobile_api.py. All authenticated calls attach the device's
// session token (never the mobile user's password) as a Bearer token.
// Scope (brand/dealer/branch) is NEVER sent by the client — the backend
// derives it from the session, per the Branch Scope Binding security rule.
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config/env';
import { getSessionToken, clearSession } from './services/session';

/** Thrown for any failed API call. `.kind` lets screens branch behaviour. */
export class ApiError extends Error {
  constructor(message, { kind = 'unknown', status = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // 'network' | 'timeout' | 'auth' | 'server' | 'client' | 'unknown'
    this.status = status;
    this.details = details;
  }
}

/**
 * A callback the app can set (from App.js / navigation root) to force the
 * user back to the pairing screen whenever a call comes back with 401/403
 * (device removed/inactivated, or mobile user deactivated).
 */
let onSessionInvalidated = null;
export function setOnSessionInvalidated(callback) {
  onSessionInvalidated = callback;
}

async function request(path, { method = 'GET', body, auth = true, query } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let url = `${API_BASE_URL}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
    );
    url += `?${params.toString()}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getSessionToken();
    if (!token) {
      throw new ApiError('No active device session — please pair this device again.', {
        kind: 'auth',
      });
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error?.name === 'AbortError') {
      throw new ApiError('The request timed out. Please check your connection and try again.', {
        kind: 'timeout',
      });
    }
    throw new ApiError('Network unavailable. Please check your internet connection.', {
      kind: 'network',
    });
  }
  clearTimeout(timeoutId);

  let payload = null;
  try {
    payload = await response.json();
  } catch (_e) {
    // Non-JSON or empty body is fine for some endpoints; ignore parse error.
  }

  if (!response.ok) {
    const message = payload?.detail || `Request failed (${response.status})`;
    if (response.status === 401 || response.status === 403) {
      await clearSession();
      if (typeof onSessionInvalidated === 'function') {
        onSessionInvalidated();
      }
      throw new ApiError(message, { kind: 'auth', status: response.status, details: payload });
    }
    if (response.status === 409) {
      throw new ApiError(message, { kind: 'client', status: response.status, details: payload });
    }
    if (response.status >= 500) {
      throw new ApiError('Server error. Please try again shortly.', {
        kind: 'server',
        status: response.status,
        details: payload,
      });
    }
    throw new ApiError(message, { kind: 'client', status: response.status, details: payload });
  }

  return payload;
}

// ==================== PAIRING (unauthenticated — this IS the login) ====================

export function verifyPairing({ mobileUserId, pairingCode, deviceUserName, deviceUserMobile, deviceName, deviceInfo, appVersion, pushToken }) {
  return request('/mobile/pairing/verify', {
    method: 'POST',
    auth: false,
    body: {
      mobile_user_id: mobileUserId,
      pairing_code: pairingCode,
      device_user_name: deviceUserName,
      device_user_mobile: deviceUserMobile,
      device_name: deviceName,
      device_info: deviceInfo,
      app_version: appVersion,
      push_token: pushToken,
    },
  });
}

export function validateSession() {
  return request('/mobile/session/validate');
}

export function registerPushToken(pushToken) {
  return request('/mobile/devices/push-token', {
    method: 'PUT',
    body: { push_token: pushToken },
  });
}

// ==================== NOTIFICATIONS ====================

export function getNotifications() {
  return request('/mobile/notifications');
}

export function acceptNotification(requestGroupKey) {
  return request('/mobile/notifications/accept', {
    method: 'POST',
    body: { request_group_key: requestGroupKey },
  });
}

export function skipNotification(requestGroupKey) {
  return request('/mobile/notifications/skip', {
    method: 'POST',
    body: { request_group_key: requestGroupKey },
  });
}

export function submitPartResponse(requestGroupKey, parts) {
  return request('/mobile/notifications/respond', {
    method: 'POST',
    body: {
      request_group_key: requestGroupKey,
      parts: parts.map((p) => ({
        order_request_id: p.orderRequestId,
        part_number: p.partNumber,
        accepted_qty: p.acceptedQty,
        remark: p.remark || null,
      })),
    },
  });
}

export function getNotificationInterval() {
  return request('/mobile/settings/notification-interval');
}

// ==================== STOCK VERIFICATION ====================

export function submitStockVerification({ partNumber, physicalQty, location, remark, entryMethod, clientId }) {
  return request('/mobile/stock-verification', {
    method: 'POST',
    body: {
      part_number: partNumber,
      physical_qty: physicalQty,
      location: location || '',
      remark: remark || '',
      entry_method: entryMethod,
      client_id: clientId,
    },
  });
}

export function getStockVerificationHistory({ partNumber, limit = 200 } = {}) {
  return request('/mobile/stock-verification/history', {
    query: { part_number: partNumber, limit },
  });
}

// ==================== STOCK SEARCH ====================

export function searchStock(partNumbersRaw) {
  return request('/mobile/stock-search', {
    query: { part_numbers: partNumbersRaw },
  });
}

// ==================== APP VERSION / UPDATE CHECK ====================

export function getLatestAppVersion() {
  return request('/mobile/app-versions/latest', { auth: false });
}
