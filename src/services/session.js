import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'sleeping_stock_mobile_session_v1';

export async function saveSession(session) {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch (error) {
    console.log('[session] Failed to save session', error);
    return false;
  }
}

export async function getSession() {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.log('[session] Failed to read session', error);
    return null;
  }
}

export async function getSessionToken() {
  const session = await getSession();
  return session?.sessionToken || null;
}

export async function clearSession() {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return true;
  } catch (error) {
    console.log('[session] Failed to clear session', error);
    return false;
  }
}

/**
 * IST calendar day key (Asia/Kolkata). Used only for display/diagnostics.
 * Authoritative daily verification session IDs come from the backend:
 * - Auto Perpetual: GET /mobile/auto-perpetual/session/today (AOPS…)
 * - Physical: created server-side on POST /mobile/stock-verification (MOPS…)
 * Do not invent a second client-side session-id strategy per part or per upload.
 */
export function istDateKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (_error) {
    // Fall through to UTC+5:30 approximation.
  }
  const istMs = date.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
