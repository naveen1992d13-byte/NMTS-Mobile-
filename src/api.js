import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl;

if (!baseURL) {
  console.warn('NMTS API URL is not configured. Set EXPO_PUBLIC_API_URL or expo.extra.apiUrl.');
}

export const api = axios.create({
  baseURL,
  timeout: 20000,
  headers: { Accept: 'application/json' },
});

api.interceptors.request.use(async config => {
  const [token, deviceId] = await Promise.all([
    SecureStore.getItemAsync('device_session'),
    SecureStore.getItemAsync('device_id'),
  ]);

  config.headers = config.headers || {};
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (deviceId) config.headers['X-Device-ID'] = deviceId;
  return config;
});

export const message = error => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map(item => item?.msg || String(item)).join('\n');
  }
  return detail || error?.message || 'Something went wrong';
};
