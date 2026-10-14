import React, { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { BLUE, MUTED } from '../theme';
import { normalizeVoicePartNumber } from '../utils/voiceNormalize';

const FALLBACK_LOCALE = 'en-IN';
const PREFERRED_LOCALE = 'ta-IN';

function friendlyVoiceError(code, message) {
  const text = `${code || ''} ${message || ''}`.toLowerCase();
  if (text.includes('denied') || text.includes('not-allowed') || code === 'not-allowed') {
    return 'Microphone permission was denied. Enable it in system settings to use Voice Type.';
  }
  if (text.includes('no-speech') || text.includes('no speech') || code === 'no-speech') {
    return 'No speech detected. Tap the microphone and say the part number again.';
  }
  if (text.includes('timeout') || text.includes('timed out') || code === 'speech-timeout') {
    return 'Voice Type timed out. Tap the microphone and try again.';
  }
  if (text.includes('not-installed') || text.includes('recognizer') || text.includes('language-not-supported')) {
    return 'Speech recognition is not available on this device.';
  }
  if (text.includes('service') || text.includes('unavailable') || code === 'service-not-allowed') {
    return 'Speech recognition is currently unavailable. Try again in a moment.';
  }
  return message || 'Voice Type could not capture the part number.';
}

async function pickLocale() {
  try {
    if (typeof ExpoSpeechRecognitionModule.getSupportedLocales !== 'function') {
      return { locale: FALLBACK_LOCALE, tamilSupported: false };
    }
    const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({
      androidRecognitionServicePackage: 'com.google.android.googlequicksearchbox',
    });
    const locales = []
      .concat(supported?.locales || [])
      .concat(Array.isArray(supported) ? supported : [])
      .map((item) => String(item?.locale || item || '').trim())
      .filter(Boolean);
    const tamilSupported = locales.some((locale) => locale.toLowerCase().startsWith('ta'));
    return {
      locale: tamilSupported ? PREFERRED_LOCALE : FALLBACK_LOCALE,
      tamilSupported,
    };
  } catch (_error) {
    return { locale: FALLBACK_LOCALE, tamilSupported: false };
  }
}

export default function VoiceTypeButton({ onAppend, disabled }) {
  const [listening, setListening] = useState(false);
  const [tamilHintShown, setTamilHintShown] = useState(false);
  const finalTextRef = useRef('');

  useSpeechRecognitionEvent('result', (event) => {
    if (event?.isFinal === false) return;
    const transcript = event?.results?.[0]?.transcript || '';
    if (transcript) finalTextRef.current = transcript;
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    Alert.alert('Voice Type', friendlyVoiceError(event?.error, event?.message));
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    if (finalTextRef.current) {
      const chunk = normalizeVoicePartNumber(finalTextRef.current);
      finalTextRef.current = '';
      if (chunk) onAppend?.(chunk);
    }
  });

  const startListening = useCallback(async () => {
    if (listening) {
      try { ExpoSpeechRecognitionModule.stop(); } catch (_error) { /* ignore */ }
      setListening(false);
      return;
    }
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (permission?.granted === false || permission?.status === 'denied') {
        Alert.alert('Voice Type', friendlyVoiceError('not-allowed'));
        return;
      }
      const { locale, tamilSupported } = await pickLocale();
      if (!tamilSupported && !tamilHintShown) {
        setTamilHintShown(true);
        Alert.alert('Voice Type', 'Tamil speech recognition is not available. Please speak the part number in English.');
      }
      finalTextRef.current = '';
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: locale,
        interimResults: false,
        maxAlternatives: 1,
        addsPunctuation: false,
      });
    } catch (error) {
      setListening(false);
      Alert.alert('Voice Type', friendlyVoiceError(error?.code, error?.message));
    }
  }, [listening, onAppend, tamilHintShown]);

  return (
    <TouchableOpacity
      style={[styles.button, listening && styles.listening]}
      onPress={startListening}
      disabled={disabled}
      accessibilityLabel="Voice Type"
    >
      <Text style={styles.icon}>{listening ? '●' : '🎙'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    marginLeft: 8,
    borderRadius: 12,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listening: {
    backgroundColor: MUTED,
  },
  icon: {
    color: '#041018',
    fontSize: 18,
    fontWeight: '900',
  },
});
