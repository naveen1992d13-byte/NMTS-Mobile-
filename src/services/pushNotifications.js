// Push notification helper for Sleeping Stock Mobile.
// Listeners register once per device session. Token errors are surfaced, not swallowed.
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken } from '../api';
import {
  ACTION_PICK_REQUEST,
  ACTION_SNOOZE,
  ANDROID_CHANNEL_IDS,
  ANDROID_SOUND_NAME,
  REQUEST_CATEGORY_ID,
  isBranchRequest,
  isPickAction,
  isSnoozeAction,
} from '../utils/requestAlert';

let responseListenerSub = null;
let receivedListenerSub = null;
let initializedForDeviceId = null;
let lastHandledResponseId = null;
let teardownFn = null;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification?.request?.content?.data || {};
    const foreground = AppState.currentState === 'active';
    const requestAlert = isBranchRequest(data);
    return {
      shouldShowAlert: true,
      // Foreground request alerts use the in-app looping ringtone. Playing the
      // notification sound here interrupts that loop (Android audio focus).
      shouldPlaySound: !(foreground && requestAlert),
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

function requestChannelOptions() {
  return {
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
  };
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  const options = requestChannelOptions();
  for (const channelId of ANDROID_CHANNEL_IDS) {
    await Notifications.setNotificationChannelAsync(channelId, options);
  }
}

async function ensureRequestCategory() {
  await Notifications.setNotificationCategoryAsync(REQUEST_CATEGORY_ID, [
    {
      identifier: ACTION_PICK_REQUEST,
      buttonTitle: 'PICK',
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
  onNotificationPicked,
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
    if (isPickAction(response?.actionIdentifier)) {
      onNotificationPicked?.(data, response);
      return;
    }
    // Notification body tap brings the app forward. Do not Pick and do not
    // stop ringing — only Pick or Snooze stop the alert.
    onNotificationTapped?.(data, response);
  };

  responseListenerSub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      handleResponse(response);
    } catch (error) {
      console.log('[push] onNotificationTapped handler error', error);
    }
  });

  // Do not replay getLastNotificationResponseAsync. A stale last-tap from a
  // previous lock/unlock would Pick the request and stop the looping ringtone.

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

export async function dismissBranchRequestNotifications() {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      (presented || [])
        .filter((item) => isBranchRequest(item?.request?.content?.data))
        .map((item) => Notifications.dismissNotificationAsync(item.request.identifier).catch(() => {}))
    );
  } catch (error) {
    console.log('[push] dismiss branch requests failed', error);
  }
}

export const PUSH_MANUAL_TEST_NOTES = [
  'Foreground popup + custom ring while app is open',
  'Background shade + custom ring while minimized',
  'Killed-app delivery via FCM',
  'PICK opens the exact request_group_key after pick lock',
  'SNOOZE dismisses only the current alert',
];
