import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { extractTextFromImage } from 'expo-text-extractor';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

import { getSession, saveSession, clearSession } from './src/services/session';
import {
  ApiError,
  setOnSessionInvalidated,
  clearApiAuthCache,
  verifyPairing,
  validateSession,
  getNotifications,
  acceptNotification,
  skipNotification,
  submitPartResponse,
  searchStock,
  getLatestAppVersion,
  getAutoPerpetualTasks,
  getAutoPerpetualSessionToday,
} from './src/api';
import {
  initOfflineQueue,
  enqueueAndTrySync,
  getPendingCount,
  subscribeToQueueChanges,
  subscribeToSyncStatus,
  startAutoSync,
  syncQueue,
} from './src/services/offlineQueue';
import {
  dismissRequestNotification,
  initPushNotifications,
  registerForPushNotificationsAsync,
} from './src/services/pushNotifications';
import {
  normalizePartNumber,
  splitPartNumbers,
  mapStockRow,
  calculateVerification,
  numberValue,
} from './src/utils/stockHelpers';
import { BLUE, BG, BORDER, CARD_SOLID, DANGER, DARK, MUTED, NEON_BLUE, NEON_CYAN, NEON_GREEN, NEON_YELLOW, SUCCESS, WARNING } from './src/theme';
import AutoPerpetualScreen from './src/components/AutoPerpetualScreen';
import StockAvailabilityScreen from './src/components/StockAvailabilityScreen';
import MultiPartSearchScreen from './src/components/MultiPartSearchScreen';
import MandatoryUpdateScreen from './src/components/MandatoryUpdateScreen';
import IncomingRequestPopup from './src/components/IncomingRequestPopup';
import { buildIncomingAlert, findRequestGroup, formatSlaRemaining, isBranchRequest } from './src/utils/requestAlert';
import {
  Empty,
  Field,
  Header,
  PrimaryButton,
  SecondaryButton,
  SquareButton,
  StatusPill,
  SyncStatusBanner,
} from './src/components/ui';

const CURRENT_VERSION_CODE = Constants.expoConfig?.android?.versionCode || 1;
const CURRENT_VERSION_NAME = Constants.expoConfig?.version || '1.0.0';

function friendlyError(error) {
  if (error instanceof ApiError) return error.message;
  return error?.message || 'Something went wrong. Please try again.';
}

function cleanPartNumber(value) {
  return normalizePartNumber(value);
}

function extractPartDetails(text) {
  const rawLines = String(text || '')
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const tokenCandidates = rawLines
    .flatMap((line) => line.split(/[\s,;:|]+/))
    .map((raw) => ({ raw, cleaned: cleanPartNumber(raw) }))
    .filter(({ cleaned }) => cleaned.length >= 4 && cleaned.length <= 40)
    .map((item) => {
      let score = 0;
      if (/\d/.test(item.cleaned)) score += 4;
      if (/[A-Z]/.test(item.cleaned)) score += 4;
      if (item.cleaned.length >= 7) score += 2;
      if (item.cleaned.length >= 10) score += 1;
      return { ...item, score };
    })
    .filter((item) => item.score >= 6)
    .sort((a, b) => b.score - a.score || b.cleaned.length - a.cleaned.length);

  const partNumber = tokenCandidates[0]?.cleaned || '';
  const description = rawLines
    .filter((line) => cleanPartNumber(line) !== partNumber)
    .filter((line) => /[A-Za-z]{3,}/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return { partNumber, description };
}

function differenceFor(systemQty, physicalQty, unitValue) {
  return calculateVerification(systemQty, physicalQty, unitValue);
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState('pair');
  const [session, setSession] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState({ state: 'idle', message: '' });
  const [mandatoryUpdate, setMandatoryUpdate] = useState(null);

  const [mobileUserId, setMobileUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingScanned, setPairingScanned] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [incomingAlert, setIncomingAlert] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [requestRows, setRequestRows] = useState([]);
  const [requestBusy, setRequestBusy] = useState(false);

  const [verificationInput, setVerificationInput] = useState('');
  const [physicalQty, setPhysicalQty] = useState('');
  const [physicalLocation, setPhysicalLocation] = useState('');
  const [verificationRemark, setVerificationRemark] = useState('');
  const [scannedPartDescription, setScannedPartDescription] = useState('');
  const [selectedPart, setSelectedPart] = useState(null);
  const [verificationList, setVerificationList] = useState([]);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [damageQty, setDamageQty] = useState('');

  const [autoTasks, setAutoTasks] = useState([]);
  const [autoSessionId, setAutoSessionId] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoAssignedCount, setAutoAssignedCount] = useState(0);
  const [autoCompletedCount, setAutoCompletedCount] = useState(0);
  const [autoLocalVerified, setAutoLocalVerified] = useState({});
  const [autoSubmitting, setAutoSubmitting] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchNotFound, setSearchNotFound] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchUploadMessage, setSearchUploadMessage] = useState('');
  const [agingThreshold, setAgingThreshold] = useState(90);

  const [multiInput, setMultiInput] = useState('');
  const [multiResults, setMultiResults] = useState([]);
  const [multiNotFound, setMultiNotFound] = useState([]);
  const [multiBusy, setMultiBusy] = useState(false);
  const [multiUploadMessage, setMultiUploadMessage] = useState('');

  const [scannerTarget, setScannerTarget] = useState('verification');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const scanLine = useRef(new Animated.Value(0)).current;
  const scanFrameLayout = useRef({ x: 36, y: 190, width: 320, height: 120 });
  const cameraLayout = useRef({ width: 390, height: 700 });
  const screenRef = useRef(screen);
  const loadAutoTasksRef = useRef(null);
  const loadNotificationsRef = useRef(null);
  const sessionRef = useRef(null);
  const notificationsRef = useRef([]);
  const incomingNotificationRef = useRef(null);
  const openRequestRef = useRef(null);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    let mounted = true;
    const stopAutoSync = startAutoSync({ periodicIntervalMs: 30000 });
    const unsubscribeQueue = subscribeToQueueChanges(async () => {
      try {
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch (_e) {}
    });
    const unsubscribeSync = subscribeToSyncStatus((status) => {
      if (mounted) setSyncStatus(status);
    });
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      if (mounted) setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });

    setOnSessionInvalidated(async () => {
      clearApiAuthCache();
      await clearSession();
      if (!mounted) return;
      setSession(null);
      setMandatoryUpdate(null);
      setScreen('pair');
      Alert.alert('Session Ended', 'This mobile must be paired again.');
    });

    (async () => {
      try {
        await initOfflineQueue();
        const count = await getPendingCount();
        if (mounted) setPendingCount(count);
      } catch (_e) {}

      try {
        const latest = await getLatestAppVersion();
        if (latest?.mandatory && numberValue(latest.version_code) > CURRENT_VERSION_CODE) {
          if (mounted) {
            setMandatoryUpdate(latest);
            setBooting(false);
            return;
          }
        }
      } catch (_e) {}

      try {
        const saved = await getSession();
        if (saved) {
          setSession(saved);
          try {
            await validateSession();
          } catch (error) {
            if (error instanceof ApiError && error.kind === 'auth') return;
          }
          if (mounted) setScreen('home');
        }
      } finally {
        if (mounted) setBooting(false);
      }
    })();

    return () => {
      mounted = false;
      stopAutoSync?.();
      unsubscribeQueue?.();
      unsubscribeSync?.();
      unsubscribeNetwork?.();
    };
  }, []);

  const loadAutoTasks = useCallback(async () => {
    setAutoBusy(true);
    try {
      // Load today's authoritative session once, then reuse that ID for every
      // verification on this screen. Backend get-or-create is idempotent per IST day.
      const sessionResp = await getAutoPerpetualSessionToday();
      const dailySessionId = sessionResp?.session_id || '';
      setAutoSessionId(dailySessionId);

      const data = await getAutoPerpetualTasks();
      setAutoTasks(data?.tasks || []);
      // Prefer the session/today ID; tasks.session_id must match after backend fix.
      if (!dailySessionId && data?.session_id) setAutoSessionId(data.session_id);
      setAutoAssignedCount(numberValue(data?.assigned_count || data?.tasks?.length || 0));
      setAutoCompletedCount(numberValue(data?.completed_count || 0));
      // Drop local entries that are no longer in today's pending list once server completed them.
      setAutoLocalVerified((current) => {
        const pendingParts = new Set((data?.tasks || []).map((t) => cleanPartNumber(t.part_number)));
        const next = {};
        Object.entries(current).forEach(([part, row]) => {
          if (pendingParts.has(part) || !row.synced) next[part] = row;
        });
        return next;
      });
    } catch (error) {
      Alert.alert('Auto Perpetual', friendlyError(error));
      setAutoTasks([]);
    } finally {
      setAutoBusy(false);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsBusy(true);
    try {
      const rows = await getNotifications();
      setNotifications(rows || []);
    } catch (error) {
      Alert.alert('Notifications', friendlyError(error));
    } finally {
      setNotificationsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadAutoTasksRef.current = loadAutoTasks;
    loadNotificationsRef.current = loadNotifications;
  }, [loadAutoTasks, loadNotifications]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    if (session?.deviceId) loadNotifications();
  }, [session?.deviceId, loadNotifications]);

  const showIncomingFromPush = useCallback(async (data, notification) => {
    if (!isBranchRequest(data)) return;
    incomingNotificationRef.current = notification || null;
    let rows = notificationsRef.current || [];
    try {
      rows = (await getNotifications()) || rows;
      setNotifications(rows);
    } catch (_e) {}
    const group = findRequestGroup(rows, data);
    setIncomingAlert(buildIncomingAlert(data, sessionRef.current, group));
  }, []);

  const openExactRequestFromPush = useCallback(async (data) => {
    setIncomingAlert(null);
    incomingNotificationRef.current = null;
    let rows = notificationsRef.current || [];
    try {
      rows = (await getNotifications()) || rows;
      setNotifications(rows);
    } catch (_e) {}
    const group = findRequestGroup(rows, data);
    if (group && openRequestRef.current) {
      openRequestRef.current(group);
      return;
    }
    setScreen('notifications');
  }, []);

  const snoozeIncomingAlert = useCallback(async () => {
    await dismissRequestNotification(incomingNotificationRef.current);
    incomingNotificationRef.current = null;
    setIncomingAlert(null);
  }, []);

  // Register push listeners once per device session — not on every screen change.
  useEffect(() => {
    if (!session?.deviceId) return undefined;
    let teardown = () => {};
    initPushNotifications({
      deviceId: session.deviceId,
      onNotificationReceived: (data, notification) => {
        if (data?.type === 'auto_perpetual') loadAutoTasksRef.current?.();
        if (isBranchRequest(data)) {
          showIncomingFromPush(data, notification);
          return;
        }
        if (screenRef.current === 'notifications') loadNotificationsRef.current?.();
      },
      onNotificationTapped: (data) => {
        if (data?.type === 'auto_perpetual') {
          loadAutoTasksRef.current?.()?.finally?.(() => setScreen('auto'));
          return;
        }
        openExactRequestFromPush(data);
      },
      onNotificationSnoozed: () => {
        snoozeIncomingAlert();
      },
      onTokenError: (error) => {
        console.log('[push] token error', error);
      },
    })
      .then((fn) => {
        teardown = fn || teardown;
      })
      .catch(() => {});
    return () => teardown();
  }, [session?.deviceId, showIncomingFromPush, openExactRequestFromPush, snoozeIncomingAlert]);

  useEffect(() => {
    const handleHardwareBack = () => {
      if (booting || mandatoryUpdate) return true;

      if (screen === 'scanner') {
        setPairingScanned(false);
        setOcrBusy(false);
        setScreen(
          scannerTarget === 'pairing'
            ? 'pair'
            : scannerTarget === 'verification'
              ? 'verification'
              : scannerTarget === 'search'
                ? 'search'
                : 'multi-search'
        );
        return true;
      }

      if (screen === 'request') {
        setScreen('notifications');
        return true;
      }

      if (screen === 'multi-search') {
        setScreen('search');
        return true;
      }

      if (screen === 'verification' || screen === 'search' || screen === 'notifications' || screen === 'auto') {
        setScreen('home');
        return true;
      }

      // Home / Pair root: allow normal Android exit behaviour (do not trap).
      if (screen === 'home' || screen === 'pair') {
        return false;
      }

      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', handleHardwareBack);
    return () => subscription.remove();
  }, [booting, screen, scannerTarget, mandatoryUpdate]);

  useEffect(() => {
    if (screen !== 'scanner') return undefined;
    scanLine.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [screen, scanLine]);

  useEffect(() => {
    if (screen === 'auto') loadAutoTasks();
  }, [screen, loadAutoTasks]);

  useEffect(() => {
    if (screen === 'notifications') loadNotifications();
  }, [screen, loadNotifications]);

  const pairDevice = async ({ qrMobileUserId, pairingType, qrPairingCode, apiBaseUrl, pairingToken }) => {
    if (!userName.trim() || !mobileNumber.trim()) {
      Alert.alert('Required', 'Enter your name and mobile number before scanning the QR code.');
      return;
    }
    if (!qrPairingCode?.trim() || !apiBaseUrl || !pairingToken || (pairingType === 'REPAIR' && !qrMobileUserId?.trim())) {
      Alert.alert('Scan QR Code', 'Scan the pairing QR code generated from the NMTS website.');
      return;
    }
    setPairingBusy(true);
    try {
      let pushToken = null;
      try {
        pushToken = await registerForPushNotificationsAsync();
      } catch (pushError) {
        console.log('[push] pairing token skipped', pushError);
        Alert.alert(
          'Push setup',
          pushError?.message || 'Could not create an Expo push token. Pairing will continue; request alerts need Firebase/FCM on this APK.'
        );
      }
      const result = await verifyPairing({
        mobileUserId: qrMobileUserId?.trim()?.toUpperCase() || null,
        pairingType,
        pairingCode: qrPairingCode.trim().toUpperCase(),
        pairingToken,
        apiBaseUrl,
        deviceUserName: userName.trim(),
        deviceUserMobile: mobileNumber.trim(),
        deviceName: Device.deviceName || `${Platform.OS} device`,
        deviceInfo: `${Device.modelName || 'Unknown'} • ${Device.osName || Platform.OS} ${Device.osVersion || ''}`,
        appVersion: CURRENT_VERSION_NAME,
        pushToken,
      });
      const nextSession = {
        apiBaseUrl,
        sessionToken: result.session_token,
        deviceId: result.device_id,
        mobileUserId: result.mobile_user_id,
        name: result.device_user_name || result.name || userName.trim(),
        deviceUserMobile: result.device_user_mobile || mobileNumber.trim(),
        brandName: result.brand_name,
        dealerName: result.dealer_name,
        branch: result.branch,
      };
      clearApiAuthCache();
      await saveSession(nextSession);
      setSession(nextSession);
      setPairingScanned(false);
      setScreen('home');
    } catch (error) {
      setPairingScanned(false);
      Alert.alert('Pairing Failed', friendlyError(error));
    } finally {
      setPairingBusy(false);
    }
  };

  const handlePairingQr = ({ data }) => {
    if (pairingScanned || pairingBusy) return;
    setPairingScanned(true);
    try {
      const parsed = JSON.parse(String(data || ''));
      const apiBaseUrl = parsed?.api_base_url || parsed?.apiBaseUrl;
      const pairingType = String(parsed?.pairing_type || (parsed?.mobile_user_id ? 'REPAIR' : 'NEW')).toUpperCase();
      const valid =
        parsed?.issuer === 'NMTS_SLEEPING_STOCK_PAIRING' &&
        [2, 3].includes(Number(parsed?.version)) &&
        ['NEW', 'REPAIR'].includes(pairingType) &&
        parsed?.pairing_code &&
        parsed?.pairing_token &&
        apiBaseUrl &&
        (pairingType !== 'REPAIR' || parsed?.mobile_user_id);
      if (!valid) throw new Error('invalid-nmts-qr');
      const detectedId = parsed?.mobile_user_id ? String(parsed.mobile_user_id).trim().toUpperCase() : '';
      setMobileUserId(detectedId);
      setPairingCode(String(parsed.pairing_code).trim().toUpperCase());
      Alert.alert(
        'NMTS QR Detected',
        pairingType === 'REPAIR'
          ? `Re-pair Mobile User: ${detectedId}\nServer: ${apiBaseUrl}`
          : `New Mobile User Pairing\nYour Mobile User ID will be created after verification.\nServer: ${apiBaseUrl}`,
        [
          { text: 'Scan Again', style: 'cancel', onPress: () => setPairingScanned(false) },
          {
            text: pairingType === 'REPAIR' ? 'Re-pair Device' : 'Pair Device',
            onPress: () =>
              pairDevice({
                qrMobileUserId: detectedId,
                pairingType,
                qrPairingCode: String(parsed.pairing_code),
                apiBaseUrl: String(apiBaseUrl),
                pairingToken: String(parsed.pairing_token),
              }),
          },
        ]
      );
    } catch (_error) {
      Alert.alert('Invalid QR Code', 'Scan only the pairing QR code generated from the NMTS website.');
      setPairingScanned(false);
    }
  };

  const logout = async () => {
    clearApiAuthCache();
    await clearSession();
    setSession(null);
    setScreen('pair');
  };

  const openScanner = async (target) => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          'Camera Permission',
          target === 'pairing'
            ? 'Camera permission is required to scan the NMTS pairing QR code.'
            : 'Camera permission is required to scan a part number.'
        );
        return;
      }
    }
    setScannerTarget(target);
    setScreen('scanner');
  };

  const scanPartNumber = async () => {
    if (ocrBusy || !cameraRef.current) return;
    setOcrBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri) throw new Error('Photo not available');

      const imageWidth = numberValue(photo.width) || 1080;
      const imageHeight = numberValue(photo.height) || 1920;
      const viewWidth = cameraLayout.current.width || 390;
      const viewHeight = cameraLayout.current.height || 700;
      const frame = scanFrameLayout.current;

      const scaleX = imageWidth / viewWidth;
      const scaleY = imageHeight / viewHeight;
      const originX = Math.max(0, Math.floor(frame.x * scaleX));
      const originY = Math.max(0, Math.floor(frame.y * scaleY));
      const cropWidth = Math.max(40, Math.min(imageWidth - originX, Math.floor(frame.width * scaleX)));
      const cropHeight = Math.max(40, Math.min(imageHeight - originY, Math.floor(frame.height * scaleY)));

      const cropped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );
      const lines = await extractTextFromImage(cropped.uri);
      const recognizedText = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
      const { partNumber: detected, description } = extractPartDetails(recognizedText);
      if (!detected) {
        Alert.alert('Not Detected', 'Keep only the part number inside the scan box and try again.');
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (scannerTarget === 'verification') {
        setScannedPartDescription(description || '');
        setVerificationInput(detected);
        setScreen('verification');
        await lookupVerificationPart(detected, description || '');
      } else if (scannerTarget === 'multi-search') {
        setMultiInput((current) => `${current ? `${current}\n` : ''}${detected}`);
        setScreen('multi-search');
      } else {
        setSearchInput(detected);
        setScreen('search');
      }
    } catch (error) {
      Alert.alert('Scan Failed', error?.message || 'Unable to scan the part number.');
    } finally {
      setOcrBusy(false);
    }
  };

  const lookupVerificationPart = async (partNumber = verificationInput, detectedDescription = scannedPartDescription) => {
    const cleaned = cleanPartNumber(partNumber);
    if (!cleaned) {
      Alert.alert('Part Number', 'Enter or scan a part number.');
      return;
    }
    setVerificationBusy(true);
    try {
      const response = await searchStock(cleaned, { mode: 'exact' });
      const match =
        (response?.results || []).map(mapStockRow).find((row) => row.partNumber === cleaned) ||
        (response?.results || []).map(mapStockRow)[0];
      if (!match) {
        setSelectedPart(null);
        Alert.alert(
          'Part Not Found',
          'This part number is not available in the paired branch data. Do you want to add it as an excess new part?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add New Part',
              onPress: () => {
                setVerificationInput(cleaned);
                setSelectedPart({
                  partNumber: cleaned,
                  partName: detectedDescription || '',
                  systemQty: 0,
                  availableQty: 0,
                  systemLocation: '-',
                  unitValue: 0,
                  isNewPart: true,
                });
                setPhysicalLocation('');
              },
            },
          ]
        );
        return;
      }
      setVerificationInput(match.partNumber);
      setSelectedPart(match);
      setPhysicalLocation(match.systemLocation === '-' ? '' : match.systemLocation);
      setScannedPartDescription('');
    } catch (error) {
      Alert.alert('Lookup Failed', friendlyError(error));
    } finally {
      setVerificationBusy(false);
    }
  };

  const addVerificationToList = () => {
    if (!selectedPart) {
      Alert.alert('Search Part', 'Search the part number first.');
      return;
    }
    if (selectedPart.isNewPart && !String(selectedPart.partName || '').trim()) {
      Alert.alert('Part Description', 'Enter or confirm the part name / description.');
      return;
    }
    if (physicalQty === '' || numberValue(physicalQty) < 0) {
      Alert.alert('Physical Quantity', 'Enter a valid physical quantity.');
      return;
    }
    if (!physicalLocation.trim()) {
      Alert.alert('Physical Location', 'Enter the physical location.');
      return;
    }
    const difference = differenceFor(selectedPart.systemQty, physicalQty, selectedPart.unitValue);
    const row = {
      id: `${Date.now()}-${Math.random()}`,
      ...selectedPart,
      physicalQty: numberValue(physicalQty),
      physicalLocation: physicalLocation.trim().toUpperCase(),
      remark: verificationRemark.trim(),
      damageQty: numberValue(damageQty),
      verificationType: 'physical',
      ...difference,
    };
    setVerificationList((current) => [...current.filter((x) => x.partNumber !== row.partNumber), row]);
    setVerificationInput('');
    setSelectedPart(null);
    setPhysicalQty('');
    setPhysicalLocation('');
    setVerificationRemark('');
    setDamageQty('');
    setScannedPartDescription('');
  };

  const submitVerificationList = async () => {
    if (!verificationList.length) return;
    // Instant local enqueue — do not block UI on network.
    setVerificationBusy(true);
    try {
      await Promise.all(
        verificationList.map((row) =>
          enqueueAndTrySync({
            partNumber: cleanPartNumber(row.partNumber),
            partName: row.partName || '',
            physicalQty: row.physicalQty,
            location: row.physicalLocation,
            remark: row.remark,
            entryMethod: 'MANUAL_OR_CAMERA',
            // Backend creates the authoritative daily MOPS session (IST).
            verificationSessionId: '',
            isNewPart: Boolean(row.isNewPart),
            verificationType: row.verificationType || 'physical',
            damageQty: numberValue(row.damageQty || 0),
          })
        )
      );
      Alert.alert('Saved', `${verificationList.length} verification record(s) saved locally. Sync continues in the background.`);
      setVerificationList([]);
      const count = await getPendingCount().catch(() => pendingCount);
      setPendingCount(count);
    } catch (error) {
      Alert.alert('Save Failed', friendlyError(error));
    } finally {
      setVerificationBusy(false);
    }
  };

  const saveAutoLocal = async ({ task, physicalQty: qty, damageQty: dmg, location, remark, status, differenceQty }) => {
    const partNumber = cleanPartNumber(task.part_number);
    // Instant local queue write — no await on network.
    const clientId = await enqueueAndTrySync({
      partNumber,
      partName: task.part_name || '',
      physicalQty: qty,
      location,
      remark,
      entryMethod: 'MANUAL_OR_CAMERA',
      verificationSessionId: autoSessionId || '',
      isNewPart: false,
      verificationType: 'auto',
      damageQty: dmg,
    });
    setAutoLocalVerified((current) => ({
      ...current,
      [partNumber]: {
        verified: true,
        synced: false,
        clientId,
        physicalQty: qty,
        damageQty: dmg,
        location,
        remark,
        status,
        differenceQty,
      },
    }));
    const count = await getPendingCount().catch(() => pendingCount + 1);
    setPendingCount(count);
  };

  const submitAutoVerified = async () => {
    setAutoSubmitting(true);
    try {
      const result = await syncQueue();
      const stillPending = await getPendingCount().catch(() => 0);
      setPendingCount(stillPending);
      // Only mark local rows synced when the queue is clear for those client IDs.
      if (!stillPending) {
        setAutoLocalVerified((current) => {
          const next = { ...current };
          Object.keys(next).forEach((part) => {
            next[part] = { ...next[part], synced: true };
          });
          return next;
        });
      }
      await loadAutoTasks();
      if (result?.skipped && result?.reason === 'offline') {
        Alert.alert('Saved Offline', 'Verified parts are stored locally and will sync when online.');
      } else if (stillPending > 0) {
        Alert.alert('Partial Sync', `${stillPending} record(s) still pending. They will retry automatically.`);
      }
    } catch (error) {
      Alert.alert('Sync Failed', friendlyError(error));
    } finally {
      setAutoSubmitting(false);
    }
  };

  const runPrefixSearch = async () => {
    const q = String(searchInput || '').trim();
    if (!q) {
      Alert.alert('Search', 'Enter a part number prefix or description.');
      return;
    }
    setSearchBusy(true);
    try {
      const response = await searchStock(q, { mode: 'prefix' });
      const unavailable = response?.today_upload_available === false;
      const uploadMsg = unavailable
        ? (response?.message || 'No stock uploaded today for this branch.')
        : '';
      setSearchUploadMessage(uploadMsg);
      const rows = unavailable ? [] : (response?.results || []).map(mapStockRow);
      setSearchResults(rows);
      // Prefix/partial search must never list the query itself as Not Found.
      setSearchNotFound([]);
      if (unavailable) {
        Alert.alert('Stock Unavailable', uploadMsg);
      } else if (!rows.length) {
        Alert.alert('No Matches', `No parts start with or match "${q}" in today's uploaded stock.`);
      }
    } catch (error) {
      Alert.alert('Search Failed', friendlyError(error));
      setSearchResults([]);
      setSearchNotFound([]);
      setSearchUploadMessage('');
    } finally {
      setSearchBusy(false);
    }
  };

  const runMultiSearch = async () => {
    const parts = splitPartNumbers(multiInput);
    if (!parts.length) {
      Alert.alert('Part Numbers', 'Paste or type one or more part numbers.');
      return;
    }
    setMultiBusy(true);
    try {
      // Exact full part numbers only — never prefix for Multiple Search.
      const response = await searchStock(parts, { mode: 'exact' });
      const unavailable = response?.today_upload_available === false;
      const uploadMsg = unavailable
        ? (response?.message || 'No stock uploaded today for this branch.')
        : '';
      setMultiUploadMessage(uploadMsg);
      if (unavailable) {
        setMultiResults([]);
        setMultiNotFound(parts);
        Alert.alert('Stock Unavailable', uploadMsg);
        return;
      }
      const results = (response?.results || []).map(mapStockRow);
      const foundSet = new Set(results.map((row) => row.partNumber));
      const missing = response?.not_found?.length
        ? response.not_found.map(cleanPartNumber).filter(Boolean)
        : parts.filter((part) => !foundSet.has(part));
      setMultiResults(results);
      setMultiNotFound(missing);
    } catch (error) {
      Alert.alert('Search Failed', friendlyError(error));
      setMultiResults([]);
      setMultiNotFound([]);
      setMultiUploadMessage('');
    } finally {
      setMultiBusy(false);
    }
  };

  const pickRequest = async (group) => {
    setRequestBusy(true);
    try {
      await acceptNotification(group.request_group_key);
      openRequest(group);
    } catch (error) {
      Alert.alert(error?.status === 409 ? 'Already Picked' : 'Unable to Pick', friendlyError(error));
      loadNotifications();
    } finally {
      setRequestBusy(false);
    }
  };

  const snoozeRequest = async (group) => {
    try {
      const result = await skipNotification(group.request_group_key);
      Alert.alert('Snoozed', `Remaining skips: ${result.skip_allowed_remaining ?? 0}`);
      loadNotifications();
    } catch (error) {
      Alert.alert('Unable to Snooze', friendlyError(error));
    }
  };

  const openRequest = (group) => {
    setSelectedRequest(group);
    setRequestRows(
      (group.parts || []).map((part) => ({
        orderRequestId: part.order_request_id,
        partNumber: part.part_number,
        partName: part.description || part.part_name || '-',
        requestedQty: numberValue(part.requested_qty),
        availableQty: numberValue(part.available_qty_at_request ?? part.available_qty),
        loc: part.loc || part.location || '-',
        purchaseAging: part.purchase_aging ?? '-',
        salesAging: part.sales_aging ?? '-',
        value: numberValue(part.part_value ?? part.value),
        acceptedQty: String(part.requested_qty ?? 0),
        remark: '',
      }))
    );
    setScreen('request');
  };

  useEffect(() => {
    openRequestRef.current = openRequest;
  });

  const submitRequestResponse = async () => {
    for (const row of requestRows) {
      const qty = numberValue(row.acceptedQty);
      if (qty < 0 || qty > row.requestedQty) {
        Alert.alert('Invalid Quantity', `Check accepted quantity for ${row.partNumber}.`);
        return;
      }
      if (qty < row.requestedQty && !row.remark.trim()) {
        Alert.alert('Remark Required', `Enter a remark for ${row.partNumber}.`);
        return;
      }
    }
    setRequestBusy(true);
    try {
      await submitPartResponse(
        selectedRequest.request_group_key,
        requestRows.map((row) => ({
          orderRequestId: row.orderRequestId,
          partNumber: row.partNumber,
          acceptedQty: numberValue(row.acceptedQty),
          remark: row.remark.trim(),
        }))
      );
      Alert.alert('Submitted', 'Request response submitted successfully.');
      setScreen('notifications');
    } catch (error) {
      Alert.alert('Submit Failed', friendlyError(error));
    } finally {
      setRequestBusy(false);
    }
  };

  if (booting) {
    return <LoadingScreen label="Opening Sleeping Stock Mobile..." />;
  }

  if (mandatoryUpdate) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <MandatoryUpdateScreen versionInfo={mandatoryUpdate} currentVersionCode={CURRENT_VERSION_CODE} />
      </SafeAreaView>
    );
  }

  const goBack = () => {
    if (screen === 'scanner') {
      setScreen(
        scannerTarget === 'pairing'
          ? 'pair'
          : scannerTarget === 'verification'
            ? 'verification'
            : scannerTarget === 'multi-search'
              ? 'multi-search'
              : 'search'
      );
    } else if (screen === 'request') setScreen('notifications');
    else if (screen === 'multi-search') setScreen('search');
    else setScreen('home');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {isOffline && (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>Offline — uploads will sync automatically</Text>
        </View>
      )}
      {screen !== 'auto' && <SyncStatusBanner status={syncStatus} />}

      {screen === 'pair' && (
        <PairScreen
          mobileUserId={mobileUserId}
          userName={userName}
          setUserName={setUserName}
          mobileNumber={mobileNumber}
          setMobileNumber={setMobileNumber}
          busy={pairingBusy}
          onScanQr={() => openScanner('pairing')}
        />
      )}
      {screen === 'home' && (
          <HomeScreen
            session={session}
            pendingCount={pendingCount}
            notificationCount={notifications.length}
            navigate={setScreen}
            logout={logout}
          />
      )}
      {screen === 'auto' && (
        <AutoPerpetualScreen
          onBack={goBack}
          sessionId={autoSessionId}
          tasks={autoTasks}
          localVerified={autoLocalVerified}
          assignedCount={autoAssignedCount}
          completedCount={autoCompletedCount}
          busy={autoBusy}
          syncStatus={syncStatus}
          onRefresh={loadAutoTasks}
          onSaveLocal={saveAutoLocal}
          onSubmitVerified={submitAutoVerified}
          submitting={autoSubmitting}
        />
      )}
      {screen === 'verification' && (
        <VerificationScreen
          onBack={goBack}
          input={verificationInput}
          setInput={setVerificationInput}
          onLookup={() => lookupVerificationPart()}
          onScan={() => openScanner('verification')}
          selectedPart={selectedPart}
          setSelectedPart={setSelectedPart}
          physicalQty={physicalQty}
          setPhysicalQty={setPhysicalQty}
          physicalLocation={physicalLocation}
          setPhysicalLocation={setPhysicalLocation}
          remark={verificationRemark}
          setRemark={setVerificationRemark}
          damageQty={damageQty}
          setDamageQty={setDamageQty}
          list={verificationList}
          removeRow={(id) => setVerificationList((rows) => rows.filter((x) => x.id !== id))}
          onAdd={addVerificationToList}
          onSubmit={submitVerificationList}
          busy={verificationBusy}
        />
      )}
      {screen === 'search' && (
        <StockAvailabilityScreen
          onBack={goBack}
          input={searchInput}
          setInput={setSearchInput}
          onSearch={runPrefixSearch}
          onScan={() => openScanner('search')}
          onOpenMulti={() => setScreen('multi-search')}
          results={searchResults}
          notFound={searchNotFound}
          busy={searchBusy}
          agingThreshold={agingThreshold}
          setAgingThreshold={setAgingThreshold}
          uploadMessage={searchUploadMessage}
        />
      )}
      {screen === 'multi-search' && (
        <MultiPartSearchScreen
          onBack={goBack}
          input={multiInput}
          setInput={setMultiInput}
          onSearch={runMultiSearch}
          results={multiResults}
          notFound={multiNotFound}
          busy={multiBusy}
          agingThreshold={agingThreshold}
          setAgingThreshold={setAgingThreshold}
          uploadMessage={multiUploadMessage}
        />
      )}
      {screen === 'notifications' && (
        <NotificationsScreen
          onBack={goBack}
          rows={notifications}
          busy={notificationsBusy || requestBusy}
          refresh={loadNotifications}
          openRequest={openRequest}
          pickRequest={pickRequest}
          snoozeRequest={snoozeRequest}
        />
      )}
      {screen === 'request' && (
        <RequestScreen
          onBack={goBack}
          request={selectedRequest}
          rows={requestRows}
          updateRow={(id, field, value) =>
            setRequestRows((items) => items.map((x) => (x.orderRequestId === id ? { ...x, [field]: value } : x)))
          }
          onSubmit={submitRequestResponse}
          busy={requestBusy}
        />
      )}
      {screen === 'scanner' &&
        (scannerTarget === 'pairing' ? (
          <PairingScannerScreen
            onBack={goBack}
            onBarcodeScanned={handlePairingQr}
            scanned={pairingScanned || pairingBusy}
            onScanAgain={() => setPairingScanned(false)}
          />
        ) : (
          <ScannerScreen
            onBack={goBack}
            permission={permission}
            cameraRef={cameraRef}
            cameraLayout={cameraLayout}
            scanFrameLayout={scanFrameLayout}
            scanLine={scanLine}
            onScan={scanPartNumber}
            busy={ocrBusy}
          />
        ))}
      <IncomingRequestPopup
        visible={Boolean(incomingAlert)}
        alert={incomingAlert}
        onOpenRequest={() => openExactRequestFromPush(incomingAlert?.data || incomingAlert)}
        onSnooze={snoozeIncomingAlert}
      />
    </SafeAreaView>
  );
}

function PairScreen(props) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 18}
    >
      <ScrollView contentContainerStyle={styles.pairPage} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Image source={require('./assets/sleeping-stock-logo.png')} style={styles.brandLogo} resizeMode="contain" />
        <Text style={styles.appTitle}>Sleeping Stock Mobile</Text>
        <Text style={styles.appSub}>PAIR THIS DEVICE</Text>
        <View style={styles.card}>
          <Field label="Your Name" value={props.userName} onChangeText={props.setUserName} />
          <Field
            label="Mobile Number"
            value={props.mobileNumber}
            onChangeText={props.setMobileNumber}
            keyboardType="phone-pad"
          />
          <Text style={styles.qrInfo}>
            The NMTS website QR contains a one-time pairing code and secure server URL. A new Mobile User ID is created after
            first pairing; Re-pair keeps the same ID.
          </Text>
          <PrimaryButton title="Scan NMTS Pairing QR" onPress={props.onScanQr} busy={props.busy} />
          {!!props.mobileUserId && <Text style={styles.detectedUser}>Detected User: {props.mobileUserId}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function HomeScreen({ session, pendingCount, notificationCount, navigate, logout }) {
  return (
    <ScrollView contentContainerStyle={styles.homePage}>
      <View style={styles.homeHeader}>
        <View style={styles.flex}>
          <Text style={styles.hello}>WELCOME BACK,</Text>
          <Text style={styles.homeName}>{session?.name || 'Mobile User'}</Text>
          <Text style={styles.homeAppLabel}>NMTS / Sleeping Stock</Text>
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => navigate('notifications')}>
          <Text style={styles.headerIcon}>🔔</Text>
          {notificationCount > 0 ? (
            <View style={styles.headerDot} />
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutChip} onPress={logout}>
          <Text style={styles.logout}>Logout</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.branchCard}>
        <Text style={styles.branchKicker}>PAIRED LOCATION</Text>
        <Text style={styles.branchTitle}>{session?.branch || 'Paired Branch'}</Text>
        <Text style={styles.branchSub}>
          {[session?.dealerName, session?.brandName].filter(Boolean).join(' • ') || 'Multi-brand dealer network'}
        </Text>
      </View>
      <MenuButton
        icon="🔔"
        accent={NEON_YELLOW}
        title="Notifications"
        subtitle="Pick and process parts requests"
        badge={notificationCount > 0 ? `${notificationCount} New` : null}
        onPress={() => navigate('notifications')}
      />
      <MenuButton
        icon="✓"
        accent={NEON_GREEN}
        title="Physical Perpetual"
        subtitle="Manual / scan stock verification (MOPS)"
        onPress={() => navigate('verification')}
      />
      <MenuButton
        icon="⚡"
        accent={NEON_CYAN}
        title="Auto Perpetual"
        subtitle="Today's assigned verification tasks (AOPS)"
        onPress={() => navigate('auto')}
      />
      <MenuButton
        icon="⌕"
        accent={NEON_BLUE}
        title="Stock Availability"
        subtitle="Product Hub style search + multiple parts"
        onPress={() => navigate('search')}
      />
      {pendingCount > 0 && (
        <View style={styles.pendingCard}>
          <Text style={styles.pendingText}>{pendingCount} verification record(s) pending upload</Text>
          <TouchableOpacity onPress={() => syncQueue()}>
            <Text style={styles.pendingAction}>Upload Now</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function VerificationScreen(props) {
  const totals = props.list.reduce(
    (a, x) => ({
      matched: a.matched + (x.status === 'MATCHED' ? 1 : 0),
      shortage: a.shortage + (x.status === 'SHORTAGE' ? 1 : 0),
      excess: a.excess + (x.status === 'EXCESS' ? 1 : 0),
    }),
    { matched: 0, shortage: 0, excess: 0 }
  );
  const diff = props.selectedPart ? differenceFor(props.selectedPart.systemQty, props.physicalQty, props.selectedPart.unitValue) : null;
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 18}
    >
      <Header title="Stock Verification" onBack={props.onBack} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.topContent, { paddingBottom: 220 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.sectionLabel}>ADDED PARTS ({props.list.length})</Text>
        {props.list.length === 0 ? (
          <Empty text="Added parts will appear here." />
        ) : (
          props.list.map((row) => <VerificationRow key={row.id} row={row} onDelete={() => props.removeRow(row.id)} />)
        )}
        <View style={styles.summaryRow}>
          <MiniStat label="Total" value={props.list.length} />
          <MiniStat label="Matched" value={totals.matched} />
          <MiniStat label="Shortage" value={totals.shortage} />
          <MiniStat label="Excess" value={totals.excess} />
        </View>
        {props.selectedPart && (
          <View style={styles.detailCard}>
            <Text style={styles.partBig}>{props.selectedPart.partNumber}</Text>
            {props.selectedPart.isNewPart ? (
              <TextInput
                style={[styles.bottomInput, { marginTop: 10 }]}
                value={props.selectedPart.partName}
                onChangeText={(value) => props.setSelectedPart((current) => ({ ...current, partName: value }))}
                placeholder="Part Name / Description"
                placeholderTextColor={MUTED}
              />
            ) : (
              <Text style={styles.partName}>{props.selectedPart.partName}</Text>
            )}
            <InfoGrid
              rows={[
                ['System Qty', props.selectedPart.systemQty],
                ['System LOC', props.selectedPart.systemLocation],
                ['Available Qty', props.selectedPart.availableQty],
                ['Unit Value', `₹${props.selectedPart.unitValue.toLocaleString('en-IN')}`],
                ['Shortage Qty', diff?.shortageQty ?? 0],
                ['Excess Qty', diff?.excessQty ?? 0],
              ]}
            />
            {diff && <StatusPill value={diff.status} />}
          </View>
        )}
      </ScrollView>
      <View style={styles.bottomPanel}>
        <View style={styles.inlineInputRow}>
          <TextInput
            style={styles.bottomInput}
            value={props.input}
            onChangeText={(v) => props.setInput(cleanPartNumber(v))}
            placeholder="Enter Part Number"
            placeholderTextColor={MUTED}
            autoCapitalize="characters"
          />
          <SquareButton title="⌕" onPress={props.onLookup} />
          <SquareButton title="▣" onPress={props.onScan} />
        </View>
        {props.selectedPart && (
          <>
            <View style={styles.twoInputs}>
              <TextInput
                style={[styles.bottomInput, styles.halfInput]}
                value={props.physicalQty}
                onChangeText={(v) => props.setPhysicalQty(v.replace(/[^0-9.]/g, ''))}
                placeholder="Physical Qty"
                keyboardType="decimal-pad"
                placeholderTextColor={MUTED}
              />
              <TextInput
                style={[styles.bottomInput, styles.halfInput]}
                value={props.physicalLocation}
                onChangeText={props.setPhysicalLocation}
                placeholder="Physical LOC"
                autoCapitalize="characters"
                placeholderTextColor={MUTED}
              />
            </View>
            <TextInput
              style={styles.bottomInput}
              value={props.remark}
              onChangeText={props.setRemark}
              placeholder="Remark (optional)"
              placeholderTextColor={MUTED}
            />
            <TextInput
              style={styles.bottomInput}
              value={props.damageQty}
              onChangeText={(v) => props.setDamageQty(v.replace(/[^0-9.]/g, ''))}
              placeholder="Damage Qty (optional)"
              keyboardType="decimal-pad"
              placeholderTextColor={MUTED}
            />
          </>
        )}
        <View style={styles.actionRow}>
          <SecondaryButton title="Add to List" onPress={props.onAdd} disabled={!props.selectedPart} />
          <PrimaryButton title={`Submit All (${props.list.length})`} onPress={props.onSubmit} disabled={!props.list.length} busy={props.busy} compact />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function NotificationsScreen({ onBack, rows, busy, refresh, openRequest, pickRequest, snoozeRequest }) {
  return (
    <View style={styles.flex}>
      <Header title="Request List" onBack={onBack} action="Refresh" onAction={refresh} />
      {busy && <ActivityIndicator style={{ marginTop: 16 }} color={BLUE} />}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.request_group_key}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={!busy ? <Empty text="No pending request for your branch." /> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.requestCard} onPress={() => openRequest(item)}>
            <View style={styles.rowBetween}>
              <Text style={styles.requestNo}>{item.request_number}</Text>
              <Text style={styles.newBadge}>NEW</Text>
            </View>
            <Text style={styles.requestFrom}>From: {item.requesting_dealer || '-'} / {item.requesting_branch || '-'}</Text>
            <Text style={styles.requestFrom}>To: {item.supplying_dealer || '-'} / {item.supplying_branch || '-'}</Text>
            <Text style={styles.requestMeta}>
              Items: {item.total_items || 0}    Qty: {item.total_quantity || 0}    SLA: {formatSlaRemaining(item.response_deadline)}
            </Text>
            <View style={styles.requestActions}>
              <TouchableOpacity style={styles.snoozeButton} onPress={() => snoozeRequest(item)}>
                <Text style={styles.snoozeText}>Snooze</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickButton} onPress={() => pickRequest(item)}>
                <Text style={styles.pickText}>Pick Request</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function RequestScreen({ onBack, request, rows, updateRow, onSubmit, busy }) {
  return (
    <View style={styles.flex}>
      <Header title="Request Parts" onBack={onBack} />
      <View style={styles.requestHeader}>
        <Text style={styles.requestHeaderNo}>{request?.request_number}</Text>
        <Text style={styles.requestHeaderSub}>{request?.requesting_branch || request?.requesting_dealer || '-'}</Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.requestPartsContent} keyboardShouldPersistTaps="handled">
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2 }]}>Part Number</Text>
          <Text style={styles.th}>Req</Text>
          <Text style={styles.th}>Avail</Text>
          <Text style={styles.th}>Accept</Text>
          <Text style={styles.th}>LOC</Text>
        </View>
        {rows.map((row) => {
          const accepted = numberValue(row.acceptedQty);
          const status = accepted === row.requestedQty ? 'ACCEPTED' : accepted === 0 ? 'REJECTED' : 'PARTIAL';
          return (
            <View key={row.orderRequestId} style={styles.requestPartRow}>
              <View style={styles.requestMainLine}>
                <Text style={[styles.tdStrong, { flex: 2 }]}>{row.partNumber}</Text>
                <Text style={styles.td}>{row.requestedQty}</Text>
                <Text style={styles.td}>{row.availableQty}</Text>
                <TextInput
                  style={styles.qtyInput}
                  value={row.acceptedQty}
                  onChangeText={(v) => updateRow(row.orderRequestId, 'acceptedQty', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.td}>{row.loc}</Text>
              </View>
              <View style={styles.requestExtra}>
                <Text style={styles.requestExtraText}>
                  {row.partName} • Purchase {row.purchaseAging} • Sales {row.salesAging}
                </Text>
                <StatusPill value={status} />
              </View>
              {status !== 'ACCEPTED' && (
                <TextInput
                  style={styles.remarkInput}
                  value={row.remark}
                  onChangeText={(v) => updateRow(row.orderRequestId, 'remark', v)}
                  placeholder="Remark required"
                  placeholderTextColor={MUTED}
                />
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.submitBar}>
        <PrimaryButton title="Submit Request Response" onPress={onSubmit} busy={busy} />
      </View>
    </View>
  );
}

function PairingScannerScreen({ onBack, onBarcodeScanned, scanned, onScanAgain }) {
  return (
    <View style={styles.scannerPage}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
      />
      <View style={styles.scannerShade} />
      <TouchableOpacity style={styles.scannerClose} onPress={onBack}>
        <Text style={styles.scannerCloseText}>×</Text>
      </TouchableOpacity>
      <View style={styles.qrFrame}>
        <View style={styles.qrCornerTL} />
        <View style={styles.qrCornerTR} />
        <View style={styles.qrCornerBL} />
        <View style={styles.qrCornerBR} />
      </View>
      <Text style={styles.scanHelp}>Scan the pairing QR generated from the NMTS website</Text>
      {scanned && (
        <View style={styles.scannerBottomBar}>
          <SecondaryButton title="Scan Again" onPress={onScanAgain} />
        </View>
      )}
    </View>
  );
}

function ScannerScreen({ onBack, cameraRef, cameraLayout, scanFrameLayout, scanLine, onScan, busy }) {
  const translateY = scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, 94] });
  return (
    <View
      style={styles.scannerPage}
      onLayout={(e) => {
        cameraLayout.current = e.nativeEvent.layout;
      }}
    >
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="picture" />
      <View style={styles.scannerShade} />
      <TouchableOpacity style={styles.scannerClose} onPress={onBack}>
        <Text style={styles.scannerCloseText}>×</Text>
      </TouchableOpacity>
      <View
        style={styles.scanFrame}
        onLayout={(e) => {
          scanFrameLayout.current = e.nativeEvent.layout;
        }}
      >
        <Animated.View style={[styles.scanBeam, { transform: [{ translateY }] }]} />
      </View>
      <Text style={styles.scanHelp}>Keep only the part number inside this box</Text>
      <View style={styles.scannerBottomBar}>
        <TouchableOpacity style={styles.scanButton} onPress={onScan} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanButtonText}>Scan Part Number</Text>}
        </TouchableOpacity>
        <Text style={styles.vibrationNote}>Vibration only • No camera sound</Text>
      </View>
    </View>
  );
}

function MenuButton({ icon, title, subtitle, onPress, accent, badge }) {
  return (
    <TouchableOpacity
      style={[styles.menuButton, accent ? { borderColor: `${accent}55`, shadowColor: accent } : null]}
      onPress={onPress}
    >
      <View style={[styles.menuIcon, accent ? { backgroundColor: `${accent}22` } : null]}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{subtitle}</Text>
      </View>
      {badge ? (
        <View style={styles.menuBadge}>
          <Text style={styles.menuBadgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}
function LoadingScreen({ label }) {
  return (
    <SafeAreaView style={[styles.safeArea, styles.center]}>
      <ActivityIndicator size="large" color={BLUE} />
      <Text style={{ marginTop: 12, color: MUTED }}>{label}</Text>
    </SafeAreaView>
  );
}
function MiniStat({ label, value }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}
function InfoGrid({ rows }) {
  return (
    <View style={styles.infoGrid}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.infoCell}>
          <Text style={styles.infoLabel}>{label}</Text>
          <Text style={styles.infoValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
function VerificationRow({ row, onDelete }) {
  return (
    <View style={styles.verificationRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowPartNo}>{row.partNumber}</Text>
        <Text style={styles.rowPartName}>{row.partName}</Text>
        <Text style={styles.rowMeta}>
          Sys: {row.systemQty}   Phys: {row.physicalQty}   LOC: {row.physicalLocation}
          {row.damageQty ? `   Dmg: ${row.damageQty}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <StatusPill value={row.status} />
        <TouchableOpacity onPress={onDelete}>
          <Text style={styles.delete}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  offline: { backgroundColor: '#fff2c7', paddingVertical: 7, alignItems: 'center' },
  offlineText: { color: '#7b5b00', fontSize: 12, fontWeight: '700' },
  pairPage: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 56 },
  qrInfo: { color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  detectedUser: { marginTop: 12, color: SUCCESS, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  brandLogo: { alignSelf: 'center', width: 190, height: 190 },
  appTitle: { marginTop: 16, textAlign: 'center', color: DARK, fontSize: 24, fontWeight: '900' },
  appSub: { marginTop: 4, marginBottom: 22, textAlign: 'center', color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  card: { backgroundColor: CARD_SOLID, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: BORDER },
  homePage: { padding: 20, paddingBottom: 50 },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hello: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  homeName: { marginTop: 3, color: DARK, fontSize: 24, fontWeight: '900' },
  homeAppLabel: { marginTop: 4, color: MUTED, fontSize: 11, fontWeight: '700' },
  headerIconButton: {
    width: 42,
    height: 42,
    marginRight: 8,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_SOLID,
  },
  headerIcon: { fontSize: 16 },
  headerDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
  },
  logoutChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_SOLID,
  },
  logout: { color: DANGER, fontWeight: '800', fontSize: 12 },
  branchCard: {
    marginTop: 20,
    marginBottom: 22,
    padding: 18,
    backgroundColor: CARD_SOLID,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: NEON_CYAN,
    shadowColor: NEON_CYAN,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  branchKicker: { color: NEON_CYAN, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  branchTitle: { marginTop: 6, color: DARK, fontSize: 22, fontWeight: '900' },
  branchSub: { marginTop: 6, color: MUTED, fontSize: 12 },
  menuButton: {
    minHeight: 82,
    marginBottom: 13,
    padding: 15,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(62, 224, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  menuTitle: { color: DARK, fontSize: 16, fontWeight: '900' },
  menuSub: { marginTop: 4, color: MUTED, fontSize: 11 },
  menuBadge: {
    marginRight: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: WARNING,
  },
  menuBadgeText: { color: '#041018', fontSize: 10, fontWeight: '900' },
  chevron: { color: BLUE, fontSize: 28 },
  pendingCard: {
    marginTop: 10,
    padding: 14,
    backgroundColor: 'rgba(240, 193, 77, 0.12)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: WARNING,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pendingText: { color: WARNING, flex: 1 },
  pendingAction: { color: BLUE, fontWeight: '900' },
  topContent: { padding: 14, paddingBottom: 20 },
  sectionLabel: { marginBottom: 10, color: DARK, fontSize: 11, fontWeight: '900' },
  verificationRow: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    flexDirection: 'row',
  },
  rowPartNo: { color: DARK, fontSize: 14, fontWeight: '900' },
  rowPartName: { marginTop: 3, color: MUTED, fontSize: 11 },
  rowMeta: { marginTop: 7, color: MUTED, fontSize: 11 },
  delete: { marginTop: 10, color: DANGER, fontSize: 11, fontWeight: '800' },
  summaryRow: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  miniStat: {
    flex: 1,
    marginRight: 6,
    paddingVertical: 10,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    alignItems: 'center',
  },
  miniValue: { color: BLUE, fontSize: 17, fontWeight: '900' },
  miniLabel: { marginTop: 3, color: MUTED, fontSize: 9 },
  detailCard: { padding: 16, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 18 },
  partBig: { color: DARK, fontSize: 19, fontWeight: '900' },
  partName: { marginTop: 4, color: MUTED },
  infoGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap' },
  infoCell: { width: '50%', paddingVertical: 8 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoValue: { marginTop: 3, color: DARK, fontWeight: '900' },
  bottomPanel: {
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 12,
    backgroundColor: CARD_SOLID,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center' },
  bottomInput: {
    flex: 1,
    minHeight: 48,
    marginBottom: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: 'rgba(8, 16, 28, 0.92)',
    color: DARK,
  },
  twoInputs: { flexDirection: 'row' },
  halfInput: { marginRight: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  listContent: { padding: 14, paddingBottom: 30 },
  requestCard: { marginBottom: 12, padding: 16, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 17 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  requestNo: { color: DARK, fontSize: 16, fontWeight: '900' },
  newBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: DANGER, color: '#fff', fontSize: 9, fontWeight: '900', overflow: 'hidden' },
  requestFrom: { marginTop: 9, color: MUTED, fontSize: 12 },
  requestMeta: { marginTop: 7, color: MUTED, fontSize: 11 },
  requestActions: { marginTop: 13, flexDirection: 'row' },
  snoozeButton: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  snoozeText: { color: MUTED, fontWeight: '800' },
  pickButton: { flex: 1.5, minHeight: 42, backgroundColor: BLUE, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pickText: { color: '#041018', fontWeight: '900' },
  requestHeader: { padding: 14, backgroundColor: CARD_SOLID, borderBottomWidth: 1, borderBottomColor: BORDER, alignItems: 'center' },
  requestHeaderNo: { color: DARK, fontSize: 17, fontWeight: '900' },
  requestHeaderSub: { marginTop: 3, color: MUTED, fontSize: 11 },
  requestPartsContent: { padding: 10, paddingBottom: 30 },
  tableHeader: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 9, backgroundColor: 'rgba(62, 224, 255, 0.12)', borderRadius: 10 },
  th: { flex: 1, color: DARK, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  requestPartRow: { marginTop: 9, padding: 10, backgroundColor: CARD_SOLID, borderWidth: 1, borderColor: BORDER, borderRadius: 13 },
  requestMainLine: { flexDirection: 'row', alignItems: 'center' },
  tdStrong: { color: DARK, fontSize: 10, fontWeight: '900' },
  td: { flex: 1, textAlign: 'center', color: DARK, fontSize: 10 },
  qtyInput: { flex: 1, height: 38, paddingHorizontal: 5, borderWidth: 1, borderColor: BORDER, borderRadius: 7, textAlign: 'center', color: DARK },
  requestExtra: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  requestExtraText: { flex: 1, color: MUTED, fontSize: 9 },
  remarkInput: { marginTop: 8, minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: BORDER, borderRadius: 9, color: DARK },
  submitBar: { padding: 12, backgroundColor: CARD_SOLID, borderTopWidth: 1, borderTopColor: BORDER },
  scannerPage: { flex: 1, backgroundColor: '#000' },
  qrFrame: { position: 'absolute', top: '28%', left: '15%', right: '15%', aspectRatio: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  qrCornerTL: { position: 'absolute', left: -2, top: -2, width: 34, height: 34, borderLeftWidth: 4, borderTopWidth: 4, borderColor: '#62f08d' },
  qrCornerTR: { position: 'absolute', right: -2, top: -2, width: 34, height: 34, borderRightWidth: 4, borderTopWidth: 4, borderColor: '#62f08d' },
  qrCornerBL: { position: 'absolute', left: -2, bottom: -2, width: 34, height: 34, borderLeftWidth: 4, borderBottomWidth: 4, borderColor: '#62f08d' },
  qrCornerBR: { position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRightWidth: 4, borderBottomWidth: 4, borderColor: '#62f08d' },
  scannerShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  scannerClose: {
    position: 'absolute',
    top: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCloseText: { color: '#fff', fontSize: 30 },
  scanFrame: {
    position: 'absolute',
    left: 36,
    right: 36,
    top: 190,
    height: 120,
    borderWidth: 2,
    borderColor: '#4ee070',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  scanBeam: { height: 3, backgroundColor: '#70ff8d', shadowColor: '#70ff8d', shadowOpacity: 1, shadowRadius: 8, elevation: 8 },
  scanHelp: { position: 'absolute', top: 330, left: 20, right: 20, textAlign: 'center', color: '#fff', fontSize: 14, fontWeight: '700' },
  scannerBottomBar: { position: 'absolute', left: 20, right: 20, bottom: 38, alignItems: 'center' },
  scanButton: { width: '100%', minHeight: 54, borderRadius: 15, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  scanButtonText: { color: '#041018', fontWeight: '900' },
  vibrationNote: { marginTop: 10, color: '#d6dbe5', fontSize: 11 },
});
