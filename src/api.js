import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl;

export const api = axios.create({
  baseURL,
  timeout: 20000,
});

api.interceptors.request.use(async config => {
  const token = await SecureStore.getItemAsync('device_session');
  const deviceId = await SecureStore.getItemAsync('device_id');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (deviceId) {
    config.headers['X-Device-ID'] = deviceId;
  }

  return config;
});

export const message = error =>
  error?.response?.data?.detail ||
  error?.message ||
  'Something went wrong';