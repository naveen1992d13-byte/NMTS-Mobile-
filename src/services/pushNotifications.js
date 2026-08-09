// Push notification helper for Sleeping Stock Mobile.
//
// Listeners must be registered once per valid device session and cleaned up
// on logout/unmount. Re-initializing on every screen change caused duplicate
// handlers in earlier builds.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken } from '../api';

const ANDROID_CHANNEL_ID = 'sleeping-stock-requests';

let responseListenerSub = null;
let receivedListenerSub = null;
let initializedForDeviceId = null;
let lastHandledResponseId = null;
let teardownFn = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Branch Stock Requests',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#176b43',
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function registerForPushNotificationsAsync() {
  try {
    await ensureAndroidChannel();

    if (!Device.isDevice) {
      console.log('[push] Skipping push registration — running on a simulator/emulator.');
      return null;
    }

    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      console.log('[push] Notification permission was not granted.');
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return tokenResponse.data;
  } catch (error) {
    console.log('[push] Failed to register for push notifications', error);
    return null;
  }
}

export async function syncPushTokenWithBackend(token) {
  if (!token) return false;
  try {
    await registerPushToken(token);
    return true;
  } catch (error) {
    console.log('[push] Failed to register push token with backend', error);
    return false;
  }
}

function removeListeners() {
  receivedListenerSub?.remove();
  responseListenerSub?.remove();
  receivedListenerSub = null;
  responseListenerSub = null;
}

/**
 * Full startup routine. Safe to call repeatedly for the same deviceId —
 * listeners are only attached once until teardown/logout.
 */
export async function initPushNotifications({
  deviceId,
  onNotificationReceived,
  onNotificationTapped,
} = {}) {
  const key = deviceId || 'default';
  if (initializedForDeviceId === key && teardownFn) {
    return teardownFn;
  }

  removeListeners();

  const token = await registerForPushNotificationsAsync();
  if (token) {
    await syncPushTokenWithBackend(token);
  }

  receivedListenerSub = Notifications.addNotificationReceivedListener((notification) => {
    try {
      onNotificationReceived?.(notification.request.content.data);
    } catch (error) {
      console.log('[push] onNotificationReceived handler error', error);
    }
  });

  responseListenerSub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const responseId = response?.notification?.request?.identifier || JSON.stringify(response?.notification?.request?.content?.data || {});
      if (responseId && responseId === lastHandledResponseId) return;
      lastHandledResponseId = responseId;
      onNotificationTapped?.(response.notification.request.content.data);
    } catch (error) {
      console.log('[push] onNotificationTapped handler error', error);
    }
  });

  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      const responseId = response?.notification?.request?.identifier || JSON.stringify(response?.notification?.request?.content?.data || {});
      if (responseId && responseId === lastHandledResponseId) return;
      lastHandledResponseId = responseId;
      onNotificationTapped?.(response.notification.request.content.data);
    })
    .catch((error) => console.log('[push] getLastNotificationResponseAsync failed', error));

  initializedForDeviceId = key;
  teardownFn = function teardownPushNotifications() {
    removeListeners();
    initializedForDeviceId = null;
    teardownFn = null;
  };
  return teardownFn;
}

/**
 * Device-only behaviours that still need a physical Android device to confirm:
 * - OS-level FCM/Expo push delivery while backgrounded or killed
 * - Notification shade appearance / channel sound / vibration
 * - Cold-start tap navigation from a killed process
 * - Duplicate suppression across process restarts
 * - Permission denial / re-prompt flows on Android 13+
 */
export const PUSH_MANUAL_TEST_NOTES = [
  'Foreground banner/alert while app is open',
  'Background delivery while app is minimized',
  'Killed-app delivery via FCM',
  'Tap opens Notifications or Auto Perpetual as expected',
  'Snooze / Skip / Pick still work after tap navigation',
  'No duplicate handler fires after screen changes',
];
