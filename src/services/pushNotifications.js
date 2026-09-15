// Push notification helper for Sleeping Stock Mobile.
// Listeners register once per device session. Token errors are surfaced, not swallowed.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken } from '../api';
import {
  ACTION_OPEN_REQUEST,
  ACTION_SNOOZE,
  ANDROID_CHANNEL_ID,
  ANDROID_SOUND_NAME,
  REQUEST_CATEGORY_ID,
  isSnoozeAction,
  shouldOpenExactRequest,
} from '../utils/requestAlert';

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
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3ee0ff',
    sound: ANDROID_SOUND_NAME,
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
}

async function ensureRequestCategory() {
  await Notifications.setNotificationCategoryAsync(REQUEST_CATEGORY_ID, [
    {
      identifier: ACTION_OPEN_REQUEST,
      buttonTitle: 'OPEN REQUEST',
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACTION_SNOOZE,
      buttonTitle: 'SNOOZE',
      options: { opensAppToForeground: false },
    },
  ]);
}

export async function registerForPushNotificationsAsync() {
  await ensureAndroidChannel();
  await ensureRequestCategory();

  if (!Device.isDevice) {
    throw new Error('Push tokens require a physical Android device.');
  }

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;
  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error('EAS projectId is missing from app.json.');
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse?.data;
  if (!token || !String(token).startsWith('ExponentPushToken[')) {
    throw new Error('Expo did not return a valid push token. Check Firebase/FCM credentials.');
  }
  return token;
}

export async function syncPushTokenWithBackend(token) {
  if (!token) return false;
  await registerPushToken(token);
  return true;
}

function removeListeners() {
  receivedListenerSub?.remove();
  responseListenerSub?.remove();
  receivedListenerSub = null;
  responseListenerSub = null;
}

function responseKey(response) {
  return (
    response?.notification?.request?.identifier ||
    JSON.stringify(response?.notification?.request?.content?.data || {})
  );
}

/**
 * Full startup routine. Safe to call repeatedly for the same deviceId.
 */
export async function initPushNotifications({
  deviceId,
  onNotificationReceived,
  onNotificationTapped,
  onNotificationSnoozed,
  onTokenError,
} = {}) {
  const key = deviceId || 'default';
  if (initializedForDeviceId === key && teardownFn) {
    return teardownFn;
  }

  removeListeners();

  try {
    const token = await registerForPushNotificationsAsync();
    if (token) await syncPushTokenWithBackend(token);
  } catch (error) {
    console.log('[push] Token registration failed', error);
    onTokenError?.(error);
  }

  receivedListenerSub = Notifications.addNotificationReceivedListener((notification) => {
    try {
      onNotificationReceived?.(notification.request.content.data, notification);
    } catch (error) {
      console.log('[push] onNotificationReceived handler error', error);
    }
  });

  const handleResponse = (response) => {
    const responseId = `${responseKey(response)}:${response?.actionIdentifier || ''}`;
    if (responseId && responseId === lastHandledResponseId) return;
    lastHandledResponseId = responseId;
    const data = response?.notification?.request?.content?.data || {};
    if (isSnoozeAction(response?.actionIdentifier)) {
      onNotificationSnoozed?.(data, response);
      return;
    }
    if (shouldOpenExactRequest(response?.actionIdentifier)) {
      onNotificationTapped?.(data, response);
    }
  };

  responseListenerSub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      handleResponse(response);
    } catch (error) {
      console.log('[push] onNotificationTapped handler error', error);
    }
  });

  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!response) return;
      handleResponse(response);
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

export async function dismissRequestNotification(notification) {
  const identifier = notification?.request?.identifier;
  if (identifier) {
    try {
      await Notifications.dismissNotificationAsync(identifier);
    } catch (error) {
      console.log('[push] dismiss failed', error);
    }
  }
}

export const PUSH_MANUAL_TEST_NOTES = [
  'Foreground popup + custom ring while app is open',
  'Background shade + custom ring while minimized',
  'Killed-app delivery via FCM',
  'OPEN REQUEST opens the exact request_group_key',
  'SNOOZE dismisses only the current alert',
];
