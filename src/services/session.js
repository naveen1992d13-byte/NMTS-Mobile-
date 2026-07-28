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
