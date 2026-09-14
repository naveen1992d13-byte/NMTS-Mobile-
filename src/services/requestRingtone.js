// In-app looping ringtone for incoming branch requests.
// Unlock / screen-wake / foreground must NOT stop this sound.
// Only Open/Pick or Snooze should stop it.
import { Platform } from 'react-native';

const SOUND = require('../../assets/sounds/sleeping_stock_alert_2_rising_dispatch.wav');

let soundObject = null;
let ringingKey = null;
let startPromise = null;

async function loadAudioModule() {
  try {
    return await import('expo-av');
  } catch (error) {
    console.log('[ringtone] expo-av is not available', error);
    return null;
  }
}

export function isRequestRingtonePlaying() {
  return Boolean(ringingKey);
}

export async function startRequestRingtone(key) {
  const nextKey = key || 'incoming-request';
  if (ringingKey === nextKey && soundObject) {
    return;
  }
  ringingKey = nextKey;
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      /* continue */
    }
  }
  startPromise = (async () => {
    const av = await loadAudioModule();
    if (!av?.Audio) return;
    try {
      await av.Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        interruptionModeAndroid: av.Audio.InterruptionModeAndroid?.DoNotMix,
        interruptionModeIOS: av.Audio.InterruptionModeIOS?.DoNotMix,
      });
    } catch (error) {
      console.log('[ringtone] audio mode failed', error);
    }
    try {
      if (soundObject) {
        await soundObject.stopAsync();
        await soundObject.unloadAsync();
        soundObject = null;
      }
      const created = await av.Audio.Sound.createAsync(
        SOUND,
        { isLooping: true, shouldPlay: true, volume: 1, isMuted: false }
      );
      if (ringingKey !== nextKey) {
        await created.sound.stopAsync();
        await created.sound.unloadAsync();
        return;
      }
      soundObject = created.sound;
    } catch (error) {
      console.log('[ringtone] start failed', error);
    }
  })();
  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function stopRequestRingtone() {
  ringingKey = null;
  const current = soundObject;
  soundObject = null;
  if (!current) return;
  try {
    await current.stopAsync();
  } catch {
    /* already stopped */
  }
  try {
    await current.unloadAsync();
  } catch {
    /* already unloaded */
  }
}

export const REQUEST_RINGTONE_PLATFORM = Platform.OS;
