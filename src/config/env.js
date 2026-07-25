// Environment configuration for Sleeping Stock Mobile.
//
// The API base URL is read from app.json -> expo.extra.apiBaseUrl so the
// same APK/build can be pointed at different backends (staging/production)
// without code changes. Override per-build with:
//   EXPO_PUBLIC_API_BASE_URL=https://your-domain.example.com/api eas build ...
// (Expo automatically exposes EXPO_PUBLIC_* env vars at build time.)
import Constants from 'expo-constants';

const fallbackApiBaseUrl = 'https://your-nmts-domain.example.com/api';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  fallbackApiBaseUrl;

export const REQUEST_TIMEOUT_MS = 20000;
