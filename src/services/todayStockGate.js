/**
 * Today's stock upload gate (IST business date).
 * Applies only to Auto Perpetual, Physical Stock Verification, Stock Availability.
 * Request/Order screens must never call this.
 */
import { getTodayStockUploadStatus } from '../api';

export const TODAY_STOCK_MISSING_MESSAGE =
  "Today's stock data is not uploaded. Please ask the branch in-charge to upload today's stock data.";

const GATED_SCREENS = new Set(['auto', 'verification', 'search']);

let cache = {
  key: '',
  uploaded: null,
  error: false,
  message: '',
  checkedAt: 0,
};

function scopeKey(session, todayHint = '') {
  if (!session) return '';
  return [
    String(session.brandName || session.brand_name || '').trim().toLowerCase(),
    String(session.dealerName || session.dealer_name || '').trim().toLowerCase(),
    String(session.branch || '').trim().toLowerCase(),
    String(todayHint || '').trim(),
  ].join('|');
}

export function isStockGatedScreen(screen) {
  return GATED_SCREENS.has(String(screen || ''));
}

export function clearTodayStockGateCache() {
  cache = { key: '', uploaded: null, error: false, message: '', checkedAt: 0 };
}

/**
 * Verify today's stock is uploaded for the paired Brand/Dealer/Branch.
 * Never assumes uploaded on API/offline errors — returns retry=true.
 */
export async function verifyTodayStockUploaded(session, { force = false } = {}) {
  const provisionalKey = scopeKey(session);
  if (
    !force &&
    cache.key &&
    cache.key.startsWith(provisionalKey) &&
    cache.uploaded === true &&
    !cache.error
  ) {
    // Still re-check date rollover via network when force not set but cache is old (>60s).
    if (Date.now() - cache.checkedAt < 60_000) {
      return { uploaded: true, error: false, retry: false, message: null, fromCache: true };
    }
  }

  try {
    const status = await getTodayStockUploadStatus();
    const today = status?.today || '';
    const key = scopeKey(session, today);
    if (status?.error) {
      cache = {
        key,
        uploaded: false,
        error: true,
        message: status.message || 'Unable to verify today\'s stock upload. Please retry.',
        checkedAt: Date.now(),
      };
      return {
        uploaded: false,
        error: true,
        retry: true,
        message: cache.message,
        fromCache: false,
      };
    }
    const uploaded = Boolean(status?.uploaded);
    cache = {
      key,
      uploaded,
      error: false,
      message: uploaded ? null : (status?.message || TODAY_STOCK_MISSING_MESSAGE),
      checkedAt: Date.now(),
    };
    return {
      uploaded,
      error: false,
      retry: !uploaded,
      message: cache.message,
      today,
      active_date_key: status?.active_date_key,
      fromCache: false,
    };
  } catch (error) {
    const message =
      error?.data?.detail?.message ||
      error?.message ||
      'Unable to verify today\'s stock upload. Please retry.';
    cache = {
      key: provisionalKey,
      uploaded: false,
      error: true,
      message: typeof message === 'string' ? message : 'Unable to verify today\'s stock upload. Please retry.',
      checkedAt: Date.now(),
    };
    return { uploaded: false, error: true, retry: true, message: cache.message, fromCache: false };
  }
}
