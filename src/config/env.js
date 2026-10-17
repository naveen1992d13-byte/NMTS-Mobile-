import Constants from 'expo-constants';

export const TESTING_API_BASE_URL = 'https://testing.sleepingstock.in/api';
export const PRODUCTION_API_BASE_URL = 'https://api.sleepingstock.in/api';

// Testing APK on this branch points only at the Testing backend.
export const ALLOWED_API_BASE_URLS = [TESTING_API_BASE_URL];
export const MANUAL_PAIRING_API_BASE_URL = TESTING_API_BASE_URL;

const fallbackApiBaseUrl = TESTING_API_BASE_URL;

export function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('NMTS server URL is not configured. Scan the pairing QR from the NMTS website.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('The NMTS server URL in the QR code is invalid.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only secure HTTPS NMTS server URLs are allowed.');
  }
  if (!ALLOWED_API_BASE_URLS.includes(raw)) {
    throw new Error('This Testing APK only accepts https://testing.sleepingstock.in. Use a Testing pairing QR.');
  }
  return raw;
}

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  fallbackApiBaseUrl;

export const REQUEST_TIMEOUT_MS = 20000;
