import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Image,
  Platform,
  RefreshControl,
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
import { extractTextFromImage, isSupported } from 'expo-text-extractor';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

import { getSession, saveSession, clearSession } from './src/services/session';
import {
  ApiError,
  setOnSessionInvalidated,
  verifyPairing,
  validateSession,
  getNotifications,
  acceptNotification,
  skipNotification,
  submitPartResponse,
  getStockVerificationHistory,
  searchStock,
  getLatestAppVersion,
} from './src/api';
import {
  initOfflineQueue,
  enqueueAndTrySync,
  getQueuedRecords,
  getPendingCount,
  subscribeToQueueChanges,
  startAutoSync,
  syncQueue,
} from './src/services/offlineQueue';
import {
  initPushNotifications,
  registerForPushNotificationsAsync,
} from './src/services/pushNotifications';

const GREEN = '#176b43';
const BG = '#eef1ef';

const CURRENT_VERSION_NAME = Constants.expoConfig?.version || '1.0.0';
const CURRENT_VERSION_CODE = Constants.expoConfig?.android?.versionCode || 1;

const normalizePairingCode = (value) => value.trim().replace(/\s+/g, '');

function friendlyError(error) {
  if (error instanceof ApiError) return error.message;
  return error?.message || 'Something went wrong. Please try again.';
}

export default function App() {
  // ---- app-level state ----
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState('pairEntry');
  const [session, setSession] = useState(null); // { sessionToken, deviceId, mobileUserId, name, brandName, dealerName, branch }
  const [isOffline, setIsOffline] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // ---- pairing state ----
  const [mobileUserIdInput, setMobileUserIdInput] = useState('');
  const [deviceUserName, setDeviceUserName] = useState('');
  const [deviceUserMobile, setDeviceUserMobile] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [scanned, setScanned] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scannerMode, setScannerMode] = useState('pairing'); // 'pairing' | 'part'

  // ---- notifications state ----
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [notificationsRefreshing, setNotificationsRefreshing] = useState(false);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [partResponses, setPartResponses] = useState([]);
  const [submittingResponse, setSubmittingResponse] = useState(false);

  // ---- verification state ----
  const [verificationPart, setVerificationPart] = useState('');
  const [verificationQty, setVerificationQty] = useState('');
  const [verificationLocation, setVerificationLocation] = useState('');
  const [verificationRemark, setVerificationRemark] = useState('');
  const [entryMethod, setEntryMethod] = useState('MANUAL');
  const [verificationHistory, setVerificationHistory] = useState([]);
  const [queuedRecords, setQueuedRecords] = useState([]);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [submittingVerification, setSubmittingVerification] = useState(false);

  // ---- search state ----
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchNotFound, setSearchNotFound] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const registrationScrollRef = useRef(null);
  const verificationScrollRef = useRef(null);
  const partCameraRef = useRef(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  // ==================== STARTUP ====================

  useEffect(() => {
    let isMounted = true;

    setOnSessionInvalidated(() => {
      if (!isMounted) return;
      setSession(null);
      setScreen('pairEntry');
      Alert.alert(
        'Session Ended',
        'This device was deactivated, removed, or the mobile user was made inactive. Please pair this device again.'
      );
    });

    const stopAutoSync = startAutoSync();
    const unsubscribeQueue = subscribeToQueueChanges(() => {
      getPendingCount()
        .then((count) => isMounted && setPendingSyncCount(count))
        .catch((error) => console.log('[App] getPendingCount failed', error));
    });

    // Lightweight connectivity awareness for the offline banner (the
    // offline queue itself uses NetInfo independently for sync timing).
    const netInfoUnsub = NetInfo.addEventListener((state) => {
      if (isMounted) setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });

    (async () => {
      try {
        await initOfflineQueue();
      } catch (error) {
        console.log('[App] initOfflineQueue failed', error);
      }

      try {
        const count = await getPendingCount();
        if (isMounted) setPendingSyncCount(count);
      } catch (error) {
        console.log('[App] getPendingCount failed', error);
      }

      // App version / mandatory update check — never blocks startup if the
      // backend is unreachable, only if it responds and says "mandatory".
      try {
        const latest = await getLatestAppVersion();
        if (isMounted) setUpdateInfo(latest);
        if (latest?.mandatory && latest.version_code > CURRENT_VERSION_CODE) {
          if (isMounted) setScreen('update-required');
          if (isMounted) setBooting(false);
          return;
        }
      } catch (error) {
        console.log('[App] version check failed (non-blocking)', error);
      }

      // Restore a previously paired session.
      try {
        const existing = await getSession();
        if (existing) {
          if (isMounted) setSession(existing);
          try {
            await validateSession();
            // Device confirmed active server-side.
          } catch (error) {
            if (error instanceof ApiError && error.kind === 'auth') {
              // setOnSessionInvalidated already handled clearing + redirect.
              if (isMounted) setBooting(false);
              return;
            }
            // Network/timeout/server error: keep the cached session and
            // continue offline rather than locking the user out.
            console.log('[App] validateSession unreachable, continuing offline', error);
          }
          if (isMounted) setScreen('home');
        }
      } catch (error) {
        console.log('[App] session restore failed', error);
      }

      if (isMounted) setBooting(false);
    })();

    return () => {
      isMounted = false;
      stopAutoSync();
      unsubscribeQueue();
      netInfoUnsub();
    };
  }, []);

  // Push notifications: wire up once we have an active session.
  useEffect(() => {
    if (!session) return undefined;
    let teardown = () => {};
    initPushNotifications({
      onNotificationReceived: () => {
        if (screen === 'notifications') loadNotifications();
      },
      onNotificationTapped: () => {
        setScreen('notifications');
      },
    })
      .then((fn) => {
        teardown = fn;
      })
      .catch((error) => console.log('[App] initPushNotifications failed', error));
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.deviceId]);

  // ==================== NAVIGATION ====================

  const goBack = () => {
    const backMap = {
      pairingOptions: 'pairEntry',
      scanner: 'pairingOptions',
      manual: 'pairingOptions',
      success: 'pairingOptions',
      notifications: 'home',
      requestDetail: 'notifications',
      verification: 'home',
      search: 'home',
      partScanner: 'verification',
    };
    setScreen(backMap[screen] || 'home');
  };

  // ==================== PAIRING ====================

  const continueFromPairEntry = () => {
    if (!mobileUserIdInput.trim()) {
      Alert.alert('Mobile User ID Required', 'Enter the Mobile User ID given to you by your NMTS admin.');
      return;
    }
    if (!deviceUserName.trim()) {
      Alert.alert('Your Name Required', 'Enter the name of the person using this device.');
      return;
    }
    if (!/^[0-9+][0-9+\-\s]{6,14}$/.test(deviceUserMobile.trim())) {
      Alert.alert('Valid Mobile Number Required', 'Enter the mobile number of the person using this device.');
      return;
    }
    setPairingError('');
    setScreen('pairingOptions');
  };

  const openScanner = async () => {
    setScannerMode('pairing');
    setScanned(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission Required', 'Camera permission is required to scan the NMTS pairing QR code.');
        return;
      }
    }
    setScreen('scanner');
  };

  const openPartScanner = async () => {
    setScannerMode('part');
    setScanned(false);
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera Permission Required', 'Camera permission is required to scan the part number.');
        return;
      }
    }
    setScreen('partScanner');
  };

  const performPairing = async (mobileUserId, pairingCode, apiBaseUrl = null, pairingToken = null) => {
    if (!mobileUserId || !pairingCode) {
      Alert.alert('Pairing Code Required', 'Enter the pairing code shown in NMTS Web.');
      return;
    }
    setPairing(true);
    setPairingError('');
    try {
      const pushToken = await registerForPushNotificationsAsync().catch(() => null);
      const deviceName = Device.deviceName || `${Platform.OS} device`;
      const deviceInfo = `${Device.modelName || 'Unknown model'} • ${Device.osName || Platform.OS} ${
        Device.osVersion || ''
      }`.trim();

      const result = await verifyPairing({
        mobileUserId: mobileUserId.trim().toUpperCase(),
        pairingCode: normalizePairingCode(pairingCode),
        pairingToken,
        deviceUserName: deviceUserName.trim(),
        deviceUserMobile: deviceUserMobile.trim(),
        deviceName,
        deviceInfo,
        appVersion: CURRENT_VERSION_NAME,
        pushToken,
        apiBaseUrl,
      });

      const newSession = {
        apiBaseUrl: apiBaseUrl || undefined,
        sessionToken: result.session_token,
        deviceId: result.device_id,
        mobileUserId: result.mobile_user_id,
        name: result.device_user_name || result.name,
        deviceUserMobile: result.device_user_mobile || deviceUserMobile.trim(),
        brandName: result.brand_name,
        dealerName: result.dealer_name,
        branch: result.branch,
      };
      await saveSession(newSession);
      setSession(newSession);
      setScreen('success');
    } catch (error) {
      const message = friendlyError(error);
      setPairingError(message);
      Alert.alert('Pairing Failed', message);
      setScanned(false);
    } finally {
      setPairing(false);
    }
  };

  const handleBarcodeScanned = ({ data }) => {
    if (scanned || pairing) return;
    setScanned(true);

    let parsedMobileUserId = '';
    let parsedCode = '';
    let parsedApiBaseUrl = null;
    let parsedPairingToken = null;
    try {
      const parsed = JSON.parse(data);
      const isNmtsQr =
        parsed?.issuer === 'NMTS_SLEEPING_STOCK_PAIRING' &&
        parsed?.version === 2 &&
        parsed?.mobile_user_id &&
        parsed?.pairing_code &&
        parsed?.pairing_token &&
        (parsed?.api_base_url || parsed?.apiBaseUrl);

      if (!isNmtsQr) {
        throw new Error('not-nmts-qr');
      }
      parsedMobileUserId = String(parsed.mobile_user_id).trim().toUpperCase();
      parsedCode = String(parsed.pairing_code).trim();
      parsedApiBaseUrl = parsed.api_base_url || parsed.apiBaseUrl;
      parsedPairingToken = String(parsed.pairing_token);
    } catch (_e) {
      Alert.alert(
        'Invalid QR Code',
        'This scanner accepts only pairing QR codes generated from the NMTS website.'
      );
      setScanned(false);
      return;
    }

    const serverLabel = `\nServer: ${parsedApiBaseUrl}`;
    Alert.alert('Pairing Code Detected', `Code: ${parsedCode}${serverLabel}`, [
      { text: 'Scan Again', style: 'cancel', onPress: () => setScanned(false) },
      { text: 'Continue', onPress: () => performPairing(parsedMobileUserId, parsedCode, parsedApiBaseUrl, parsedPairingToken) },
    ]);
  };

  const submitManualCode = () => {
    if (!manualCode.trim()) {
      Alert.alert('Pairing Code Required', 'Enter the code shown in NMTS Web.');
      return;
    }
    performPairing(mobileUserIdInput, manualCode);
  };

  const resetRegistration = async () => {
    await clearSession();
    setSession(null);
    setMobileUserIdInput('');
    setDeviceUserName('');
    setDeviceUserMobile('');
    setManualCode('');
    setScanned(false);
    setPairing(false);
    setScreen('pairEntry');
  };

  // ==================== NOTIFICATIONS ====================

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const rows = await getNotifications();
      setNotifications(rows || []);
    } catch (error) {
      setNotificationsError(friendlyError(error));
    } finally {
      setNotificationsLoading(false);
      setNotificationsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (screen === 'notifications') loadNotifications();
  }, [screen, loadNotifications]);

  const onRefreshNotifications = () => {
    setNotificationsRefreshing(true);
    loadNotifications({ silent: true });
  };

  const handleAccept = async (group) => {
    setActionBusyId(group.request_group_key);
    try {
      await acceptNotification(group.request_group_key);
      openRequestDetail(group, { justAccepted: true });
      loadNotifications({ silent: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        Alert.alert('Already Accepted', 'This request was already accepted by another user.');
      } else {
        Alert.alert('Could Not Accept', friendlyError(error));
      }
      loadNotifications({ silent: true });
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSkip = async (group) => {
    setActionBusyId(group.request_group_key);
    try {
      const result = await skipNotification(group.request_group_key);
      Alert.alert('Skipped', `Remaining skips for this request: ${result.skip_allowed_remaining}`);
      loadNotifications({ silent: true });
    } catch (error) {
      Alert.alert('Could Not Skip', friendlyError(error));
    } finally {
      setActionBusyId(null);
    }
  };

  // ==================== PART-WISE RESPONSE ====================

  const openRequestDetail = (group, { justAccepted = false } = {}) => {
    setSelectedGroup(group);
    setPartResponses(
      (group.parts || []).map((p) => ({
        orderRequestId: p.order_request_id,
        partNumber: p.part_number,
        description: p.description,
        requestedQty: Number(p.requested_qty || 0),
        availableQty: p.available_qty_at_request,
        loc: p.loc,
        acceptedQty: String(p.requested_qty ?? ''), // default: full acceptance
        remark: '',
      }))
    );
    if (justAccepted) {
      Alert.alert('Accepted', 'Now enter the accepted quantity for each part.');
    }
    setScreen('requestDetail');
  };

  const updatePartResponse = (orderRequestId, field, value) => {
    setPartResponses((rows) => rows.map((r) => (r.orderRequestId === orderRequestId ? { ...r, [field]: value } : r)));
  };

  const submitAllPartResponses = async () => {
    if (!selectedGroup) return;

    for (const row of partResponses) {
      const qty = Number(row.acceptedQty);
      if (row.acceptedQty === '' || Number.isNaN(qty) || qty < 0) {
        Alert.alert('Invalid Quantity', `Enter a valid accepted quantity for ${row.partNumber}.`);
        return;
      }
      if (qty > row.requestedQty) {
        Alert.alert('Quantity Too High', `Accepted quantity for ${row.partNumber} cannot exceed the requested quantity (${row.requestedQty}).`);
        return;
      }
      if (qty < row.requestedQty && !row.remark.trim()) {
        Alert.alert(
          'Remark Required',
          `${row.partNumber} is ${qty === 0 ? 'rejected' : 'partially accepted'} — a remark is required before you can submit.`
        );
        return;
      }
    }

    setSubmittingResponse(true);
    try {
      const result = await submitPartResponse(
        selectedGroup.request_group_key,
        partResponses.map((r) => ({
          orderRequestId: r.orderRequestId,
          partNumber: r.partNumber,
          acceptedQty: Number(r.acceptedQty),
          remark: r.remark.trim(),
        }))
      );
      const rejectedCount = result.results.filter((r) => r.status === 'Rejected').length;
      const summary =
        rejectedCount === 0
          ? 'All parts submitted successfully.'
          : `${rejectedCount} of ${result.results.length} part(s) marked Rejected.`;
      Alert.alert('Response Submitted', summary);
      setSelectedGroup(null);
      setPartResponses([]);
      setScreen('notifications');
      loadNotifications({ silent: true });
    } catch (error) {
      Alert.alert('Could Not Submit Response', friendlyError(error));
    } finally {
      setSubmittingResponse(false);
    }
  };

  const acceptAllFully = () => {
    setPartResponses((rows) => rows.map((r) => ({ ...r, acceptedQty: String(r.requestedQty), remark: '' })));
  };

  // ==================== STOCK VERIFICATION ====================

  const loadVerificationData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setVerificationLoading(true);
    setVerificationError('');
    try {
      const [history, queued] = await Promise.all([
        getStockVerificationHistory({ limit: 100 }).catch((error) => {
          // History is a nice-to-have; don't block the screen if it fails
          // (e.g. offline) — the offline queue view below still works.
          console.log('[App] verification history load failed', error);
          return [];
        }),
        getQueuedRecords(),
      ]);
      setVerificationHistory(history || []);
      setQueuedRecords(queued || []);
    } catch (error) {
      setVerificationError(friendlyError(error));
    } finally {
      setVerificationLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen === 'verification') loadVerificationData();
  }, [screen, loadVerificationData]);

  useEffect(() => {
    const unsubscribe = subscribeToQueueChanges(() => {
      if (screen === 'verification') loadVerificationData({ silent: true });
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const submitVerification = async () => {
    if (!verificationPart.trim()) {
      Alert.alert('Part Number Required', 'Enter or scan the part number.');
      return;
    }
    if (!verificationQty.trim() || Number(verificationQty) < 0) {
      Alert.alert('Quantity Required', 'Enter a valid physical quantity.');
      return;
    }
    if (!verificationLocation.trim()) {
      Alert.alert('Location Required', 'Enter the physical stock location.');
      return;
    }

    setSubmittingVerification(true);
    try {
      await enqueueAndTrySync({
        partNumber: verificationPart.trim().toUpperCase(),
        physicalQty: Number(verificationQty),
        location: verificationLocation.trim().toUpperCase(),
        remark: verificationRemark.trim(), // optional — never forced
        entryMethod,
      });

      Alert.alert(
        'Verification Queued',
        isOffline
          ? 'Saved locally. It will sync automatically once you are back online.'
          : 'Submitted for sync.'
      );

      setVerificationPart('');
      setVerificationQty('');
      setVerificationLocation('');
      setVerificationRemark('');
      setEntryMethod('MANUAL');
      loadVerificationData({ silent: true });
    } catch (error) {
      Alert.alert('Could Not Queue Verification', friendlyError(error));
    } finally {
      setSubmittingVerification(false);
    }
  };

  const manualRetrySync = async () => {
    try {
      const result = await syncQueue();
      if (result.skipped) {
        Alert.alert('Still Offline', 'No internet connection detected yet.');
      } else {
        Alert.alert('Sync Complete', `Synced: ${result.synced} • Failed: ${result.failed}`);
      }
      loadVerificationData({ silent: true });
    } catch (error) {
      Alert.alert('Sync Failed', friendlyError(error));
    }
  };

  // ---- Camera OCR (unchanged detection logic, wired into new state) ----

  const extractPartNumber = (rawText) => {
    const normalized = String(rawText || '')
      .toUpperCase()
      .replace(/[—–_]/g, '-')
      .replace(/[^A-Z0-9\-/\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return '';

    const candidates = normalized
      .split(' ')
      .map((value) => value.replace(/^-+|-+$/g, '').trim())
      .filter((value) => value.length >= 4 && value.length <= 30)
      .map((value) => {
        let score = 0;
        if (/[A-Z]/.test(value)) score += 3;
        if (/[0-9]/.test(value)) score += 3;
        if (/[-/]/.test(value)) score += 3;
        if (/^[A-Z0-9\-/]+$/.test(value)) score += 2;
        return { value, score };
      })
      .filter((item) => item.score >= 7)
      .sort((a, b) => b.score - a.score || b.value.length - a.value.length);

    return candidates[0]?.value || '';
  };

  const captureAndRecognizePart = async () => {
    if (!partCameraRef.current || ocrBusy) return;

    if (!isSupported) {
      Alert.alert('OCR Not Supported', 'Offline text recognition is not supported on this device.');
      return;
    }

    setOcrBusy(true);
    try {
      const photo = await partCameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (!photo?.uri) throw new Error('Camera image was not captured.');

      const recognizedLines = await extractTextFromImage(photo.uri);
      const recognizedText = Array.isArray(recognizedLines) ? recognizedLines.join(' ') : String(recognizedLines || '');
      const detectedPart = extractPartNumber(recognizedText);

      if (!detectedPart) {
        Alert.alert('Part Number Not Detected', 'Keep one part number inside the box, use good lighting, and scan again.');
        return;
      }

      setVerificationPart(detectedPart);
      setEntryMethod('CAMERA_OCR');
      setScreen('verification');

      setTimeout(() => {
        Alert.alert('Part Number Detected', `${detectedPart}\n\nPlease verify the text before submitting.`);
      }, 250);
    } catch (error) {
      Alert.alert('Offline OCR Failed', error?.message || 'Unable to read the part number. Please scan again.');
    } finally {
      setOcrBusy(false);
    }
  };

  // ==================== STOCK SEARCH ====================

  const runStockSearch = async () => {
    if (!searchText.trim()) {
      Alert.alert('Part Number Required', 'Enter one or more part numbers.');
      return;
    }
    setSearchLoading(true);
    setSearchError('');
    try {
      const response = await searchStock(searchText);
      setSearchResults(response?.results || []);
      setSearchNotFound(response?.not_found || []);
    } catch (error) {
      setSearchError(friendlyError(error));
      setSearchResults([]);
      setSearchNotFound([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // ==================== SHARED UI PIECES ====================

  const OfflineBanner = () =>
    isOffline ? (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineBannerText}>You're offline — actions will sync automatically when reconnected</Text>
      </View>
    ) : null;

  const Header = ({ title, subtitle }) => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={goBack}>
        <Text style={styles.backText}>‹</Text>
      </TouchableOpacity>
      <View style={styles.headerTextWrap}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.headerSpacer} />
    </View>
  );

  const ErrorBox = ({ message, onRetry }) => (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {!!onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ==================== SCREENS ====================

  const BootingScreen = () => (
    <View style={styles.centerScreen}>
      <ActivityIndicator size="large" color={GREEN} />
      <Text style={styles.loadingText}>Starting Sleeping Stock Mobile...</Text>
    </View>
  );

  const UpdateRequiredScreen = () => (
    <View style={styles.updateScreen}>
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>Update Required</Text>
        <Text style={styles.updateDescription}>
          A mandatory update ({updateInfo?.version_name || 'latest version'}) is required before you can continue
          using Sleeping Stock Mobile.
          {updateInfo?.release_notes ? `\n\n${updateInfo.release_notes}` : ''}
        </Text>
        <Text style={styles.updateNote}>
          Open the NMTS Web application on this device and download the latest APK from the Sleeping Stock Mobile
          section, then install it to continue.
        </Text>
      </View>
    </View>
  );

  const PairEntryScreen = () => (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
      <ScrollView ref={registrationScrollRef} contentContainerStyle={styles.registrationContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.logoContainer}>
          <Image source={require('./assets/sleeping-stock-logo-transparent.png')} style={styles.brandLogo} resizeMode="contain" />
          <Text style={styles.appName}>Sleeping Stock</Text>
          <Text style={styles.appSubtitle}>NMTS Mobile</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Connect This Mobile</Text>
          <Text style={styles.description}>
            Enter the Mobile User ID given to you by your NMTS admin, then pair using the QR code or manual code
            shown in NMTS Web.
          </Text>

          <Text style={styles.label}>Mobile User ID</Text>
          <TextInput
            style={styles.input}
            value={mobileUserIdInput}
            onChangeText={(value) => setMobileUserIdInput(value.toUpperCase())}
            placeholder="e.g. MUAMB2607200001"
            placeholderTextColor="#8a948f"
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={styles.label}>Device User Name</Text>
          <TextInput style={styles.input} value={deviceUserName} onChangeText={setDeviceUserName} placeholder="Person using this mobile" placeholderTextColor="#8a948f" autoCapitalize="words" />

          <Text style={styles.label}>Device User Mobile Number</Text>
          <TextInput style={styles.input} value={deviceUserMobile} onChangeText={setDeviceUserMobile} placeholder="10-digit mobile number" placeholderTextColor="#8a948f" keyboardType="phone-pad" />

          {!!pairingError && <Text style={styles.errorText}>{pairingError}</Text>}

          <TouchableOpacity style={styles.primaryButton} onPress={continueFromPairEntry}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerText}>Non Moving Tracking System</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const PairingOptionsScreen = () => (
    <View style={styles.flex}>
      <Header title="Pair Your Mobile" subtitle="NMTS MOBILE ACCESS" />
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.card}>
          <Text style={styles.title}>Connect this device</Text>
          <Text style={styles.description}>
            Scan only the secure pairing QR displayed in NMTS Web.
          </Text>

          <View style={styles.userSummary}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{deviceUserName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.userDetails}>
              <Text style={styles.userName}>{deviceUserName}</Text>
              <Text style={styles.userMobile}>{deviceUserMobile} · {mobileUserIdInput}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={openScanner}>
            <Text style={styles.buttonIcon}>▣</Text>
            <Text style={styles.primaryButtonText}>Scan Pairing QR Code</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </View>
  );

  const ScannerScreen = () => {
    if (!permission) {
      return (
        <View style={styles.centerScreen}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Checking camera permission...</Text>
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.centerScreen}>
          <Text style={styles.title}>Camera Permission Required</Text>
          <Text style={styles.centerDescription}>Allow camera access to scan the NMTS pairing QR code.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={goBack}>
            <Text style={styles.textButtonLabel}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scannerScreen}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerTop}>
            <TouchableOpacity style={styles.scannerBackButton} onPress={goBack}>
              <Text style={styles.scannerBackText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Pairing QR</Text>
            <View style={styles.scannerBackButton} />
          </View>
          <View style={styles.scannerCenter}>
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            <Text style={styles.scanInstruction}>Place the NMTS pairing QR code inside the frame</Text>
          </View>
          <View style={styles.scannerBottom}>
<Text style={styles.scanInstruction}>Only NMTS Web-generated QR codes are accepted.</Text>
          </View>
        </View>
        {pairing && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={styles.processingText}>Pairing your mobile...</Text>
          </View>
        )}
      </View>
    );
  };

  const ManualPairingScreen = () => (
    <View style={styles.flex}>
      <Header title="Manual Pairing" subtitle="ENTER ACCESS CODE" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.centerTitle}>Enter Pairing Code</Text>
            <Text style={styles.centerDescription}>Enter the one-time code displayed below the QR code in NMTS Web.</Text>

            <TextInput
              style={styles.codeInput}
              value={manualCode}
              onChangeText={(value) => setManualCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24))}
              placeholder="NMTS-8435-2201"
              placeholderTextColor="#96a09b"
              autoCapitalize="characters"
              autoCorrect={false}
              textAlign="center"
            />

            <TouchableOpacity style={[styles.primaryButton, pairing && styles.disabledButton]} onPress={submitManualCode} disabled={pairing}>
              {pairing ? (
                <>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={styles.loadingButtonText}>Verifying...</Text>
                </>
              ) : (
                <Text style={styles.primaryButtonText}>Verify and Pair</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.textButton} onPress={openScanner}>
              <Text style={styles.textButtonLabel}>Scan QR Code Instead</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );

  const PartScannerScreen = () => {
    if (!permission) {
      return (
        <View style={styles.centerScreen}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Checking camera permission...</Text>
        </View>
      );
    }
    if (!permission.granted) {
      return (
        <View style={styles.centerScreen}>
          <Text style={styles.title}>Camera Permission Required</Text>
          <Text style={styles.centerDescription}>Allow camera access to capture the part number.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={() => setScreen('verification')}>
            <Text style={styles.textButtonLabel}>Go Back</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scannerScreen}>
        <CameraView ref={partCameraRef} style={StyleSheet.absoluteFillObject} facing="back" />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerTop}>
            <TouchableOpacity style={styles.scannerBackButton} onPress={() => setScreen('verification')}>
              <Text style={styles.scannerBackText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.scannerTitle}>Scan Part Number</Text>
            <View style={styles.scannerBackButton} />
          </View>
          <View style={styles.scannerCenter}>
            <View style={styles.partScanFrame}>
              <Text style={styles.partScanHint}>PART NUMBER</Text>
            </View>
            <Text style={styles.scanInstruction}>Keep the printed part number clearly inside the frame.</Text>
          </View>
          <View style={styles.partScannerBottom}>
            <TouchableOpacity style={[styles.captureButton, ocrBusy && styles.disabledButton]} onPress={captureAndRecognizePart} disabled={ocrBusy}>
              {ocrBusy ? <ActivityIndicator size="large" color="#176b43" /> : <View style={styles.captureInner} />}
            </TouchableOpacity>
            {ocrBusy && <Text style={styles.ocrProcessingText}>Reading part number offline...</Text>}
            <TouchableOpacity style={styles.manualLinkButton} onPress={() => setScreen('verification')}>
              <Text style={styles.manualLinkText}>Enter part number manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const SuccessScreen = () => (
    <View style={styles.successScreen}>
      <View style={styles.successCircle}>
        <Text style={styles.successCheck}>✓</Text>
      </View>
      <Text style={styles.successTitle}>Pairing Successful</Text>
      <Text style={styles.successDescription}>This mobile has been connected successfully.</Text>
      <View style={styles.successDetails}>
        <Text style={styles.successLine}>{session?.name}</Text>
        <Text style={styles.successLine}>{session?.mobileUserId}</Text>
        <Text style={styles.successCode}>
          {session?.brandName} • {session?.dealerName} • {session?.branch}
        </Text>
      </View>
      <TouchableOpacity style={styles.primaryButtonWide} onPress={() => setScreen('home')}>
        <Text style={styles.primaryButtonText}>Open Sleeping Stock</Text>
      </TouchableOpacity>
    </View>
  );

  const HomeScreen = () => (
    <ScrollView style={styles.flex} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
      <OfflineBanner />
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.homeWelcome}>Welcome</Text>
          <Text style={styles.homeUserName}>{session?.name || session?.mobileUserId}</Text>
        </View>
        <View style={styles.homeAvatar}>
          <Text style={styles.homeAvatarText}>{(session?.name || session?.mobileUserId || '?').charAt(0).toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.homeBrandCard}>
        <View style={styles.homeLogoBox}>
          <Text style={styles.homeLogoText}>SS</Text>
        </View>
        <View style={styles.homeBrandDetails}>
          <Text style={styles.homeBrandTitle}>Sleeping Stock</Text>
          <Text style={styles.homeBrandSubtitle}>Non Moving Tracking System</Text>
        </View>
        <View style={styles.activeBadge}>
          <Text style={styles.activeBadgeText}>ACTIVE</Text>
        </View>
      </View>

      <View style={styles.scopeRow}>
        <View style={styles.scopePill}>
          <Text style={styles.scopePillText}>{session?.brandName}</Text>
        </View>
        <View style={styles.scopePill}>
          <Text style={styles.scopePillText}>{session?.dealerName}</Text>
        </View>
        <View style={styles.scopePill}>
          <Text style={styles.scopePillText}>{session?.branch}</Text>
        </View>
      </View>

      {updateInfo && !updateInfo.mandatory && updateInfo.version_code > CURRENT_VERSION_CODE && (
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>New update available ({updateInfo.version_name}) — open NMTS Web to download</Text>
        </View>
      )}

      {pendingSyncCount > 0 && (
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>{pendingSyncCount} verification record(s) waiting to sync</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Mobile Services</Text>

      <MenuCard icon="🔔" title="Notifications" description="View and respond to branch requests" onPress={() => setScreen('notifications')} />
      <MenuCard icon="✓" title="Stock Verification" description="Submit physical quantity and location" onPress={() => setScreen('verification')} />
      <MenuCard icon="⌕" title="Stock Search" description="Search single or multiple part numbers" onPress={() => setScreen('search')} />

      <TouchableOpacity
        style={styles.resetButton}
        onPress={() =>
          Alert.alert('Log Out This Device', 'This will remove pairing on this device. You will need to pair again to continue.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log Out', style: 'destructive', onPress: resetRegistration },
          ])
        }
      >
        <Text style={styles.resetButtonText}>Log Out / Remove Pairing</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const NotificationsScreen = () => (
    <View style={styles.flex}>
      <Header title="Notifications" subtitle="BRANCH REQUESTS" />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={notificationsRefreshing} onRefresh={onRefreshNotifications} colors={[GREEN]} />}
      >
        {notificationsLoading && (
          <View style={styles.inlineLoadingRow}>
            <ActivityIndicator color={GREEN} />
            <Text style={styles.inlineLoadingText}>Loading notifications...</Text>
          </View>
        )}

        {!notificationsLoading && !!notificationsError && (
          <ErrorBox message={notificationsError} onRetry={() => loadNotifications()} />
        )}

        {!notificationsLoading && !notificationsError && notifications.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No pending requests for your branch right now.</Text>
          </View>
        )}

        {!notificationsLoading &&
          notifications.map((item) => (
            <View key={item.request_group_key} style={styles.requestCard}>
              <View style={styles.requestTopRow}>
                <Text style={styles.requestNumber}>{item.request_number}</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{item.total_items} part{item.total_items === 1 ? '' : 's'}</Text>
                </View>
              </View>
              <Text style={styles.requestBranch}>From {item.requesting_dealer || 'Requesting Dealer'}</Text>
              {!!item.requested_at && <Text style={styles.requestMeta}>Requested: {new Date(item.requested_at).toLocaleString()}</Text>}
              <View style={styles.detailGrid}>
                <View style={styles.detailCell}>
                  <Text style={styles.detailCellLabel}>TOTAL QTY</Text>
                  <Text style={styles.detailCellValue}>{item.total_quantity}</Text>
                </View>
                <View style={styles.detailCell}>
                  <Text style={styles.detailCellLabel}>TOTAL VALUE</Text>
                  <Text style={styles.detailCellValue}>{item.total_value?.toLocaleString?.() ?? item.total_value}</Text>
                </View>
              </View>

              {item.accepted_by_another && (
                <View style={styles.acceptedByOtherBadge}>
                  <Text style={styles.acceptedByOtherText}>Already accepted by another user</Text>
                </View>
              )}

              {item.accepted_by_me && (
                <TouchableOpacity style={styles.primaryButton} onPress={() => openRequestDetail(item)}>
                  <Text style={styles.primaryButtonText}>Enter Part-wise Response</Text>
                </TouchableOpacity>
              )}

              {!item.accepted_by_another && !item.accepted_by_me && (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.outlineButton, (!item.skip_allowed || actionBusyId === item.request_group_key) && styles.disabledButton]}
                    onPress={() => handleSkip(item)}
                    disabled={!item.skip_allowed || actionBusyId === item.request_group_key}
                  >
                    <Text style={styles.outlineButtonText}>{item.skip_allowed ? 'Skip' : 'Skip limit reached'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallPrimaryButton, actionBusyId === item.request_group_key && styles.disabledButton]}
                    onPress={() => handleAccept(item)}
                    disabled={actionBusyId === item.request_group_key}
                  >
                    {actionBusyId === item.request_group_key ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
      </ScrollView>
    </View>
  );

  const RequestDetailScreen = () => {
    if (!selectedGroup) {
      return (
        <View style={styles.centerScreen}>
          <Text style={styles.title}>No request selected</Text>
          <TouchableOpacity style={styles.textButton} onPress={() => setScreen('notifications')}>
            <Text style={styles.textButtonLabel}>Back to Notifications</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.flex}>
        <Header title={selectedGroup.request_number} subtitle="PART-WISE RESPONSE" />
        <OfflineBanner />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.verificationPageContent} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <Text style={styles.description}>
                Enter the Accepted Quantity for each part. Full acceptance needs no remark — partial or rejected parts
                require one.
              </Text>
              <TouchableOpacity style={styles.textButton} onPress={acceptAllFully}>
                <Text style={styles.textButtonLabel}>Accept All Parts Fully</Text>
              </TouchableOpacity>
            </View>

            {partResponses.map((row) => {
              const qty = row.acceptedQty === '' ? NaN : Number(row.acceptedQty);
              const isFull = !Number.isNaN(qty) && qty === row.requestedQty;
              const isRejected = !Number.isNaN(qty) && qty === 0;
              const isPartial = !Number.isNaN(qty) && qty > 0 && qty < row.requestedQty;
              const remarkNeeded = isPartial || isRejected;

              return (
                <View key={row.orderRequestId} style={styles.verificationRowCard}>
                  <View style={styles.verificationRowTop}>
                    <View style={styles.partNumberWrap}>
                      <Text style={styles.verificationPartNo}>{row.partNumber}</Text>
                      <Text style={styles.verificationTime}>{row.description}</Text>
                    </View>
                    <View
                      style={
                        isRejected ? styles.acceptedByOtherBadge : isPartial ? styles.pendingBadge : styles.verifiedBadge
                      }
                    >
                      <Text style={isRejected ? styles.acceptedByOtherText : isPartial ? styles.pendingBadgeText : styles.verifiedBadgeText}>
                        {isRejected ? 'Rejected' : isPartial ? 'Partial' : isFull ? 'Full Accept' : 'Enter Qty'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailGrid}>
                    <View style={styles.detailCell}>
                      <Text style={styles.detailCellLabel}>REQUESTED</Text>
                      <Text style={styles.detailCellValue}>{row.requestedQty}</Text>
                    </View>
                    <View style={styles.detailCell}>
                      <Text style={styles.detailCellLabel}>AVAILABLE</Text>
                      <Text style={styles.detailCellValue}>{row.availableQty ?? '-'}</Text>
                    </View>
                  </View>

                  <Text style={styles.label}>Accepted Quantity</Text>
                  <TextInput
                    style={styles.input}
                    value={row.acceptedQty}
                    onChangeText={(value) => updatePartResponse(row.orderRequestId, 'acceptedQty', value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    placeholderTextColor="#8a948f"
                    keyboardType="decimal-pad"
                  />

                  <Text style={styles.label}>Remark {remarkNeeded ? '(required)' : '(optional)'}</Text>
                  <TextInput
                    style={[styles.input, styles.multilineInput]}
                    value={row.remark}
                    onChangeText={(value) => updatePartResponse(row.orderRequestId, 'remark', value)}
                    placeholder={remarkNeeded ? 'Reason for partial/rejected quantity' : 'Optional remark'}
                    placeholderTextColor="#8a948f"
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.primaryButton, submittingResponse && styles.disabledButton]}
              onPress={submitAllPartResponses}
              disabled={submittingResponse}
            >
              {submittingResponse ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Submit Response</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  };

  const VerificationScreen = () => {
    const combinedRows = [
      ...queuedRecords.map((r) => ({
        id: r.client_id,
        partNo: r.part_number,
        qty: String(r.physical_qty),
        location: r.location,
        remark: r.remark,
        status: r.sync_status === 'failed' ? `Retry pending (${r.retry_count})` : 'Pending Sync',
        time: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pending: true,
      })),
      ...verificationHistory.map((r) => ({
        id: r.id,
        partNo: r.part_number,
        qty: String(r.physical_quantity),
        location: r.location,
        remark: r.remark,
        status: 'Synced',
        time: r.verified_at ? new Date(r.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        pending: false,
      })),
    ];

    return (
      <View style={styles.flex}>
        <Header title="Stock Verification" subtitle="PHYSICAL STOCK CHECK" />
        <OfflineBanner />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            ref={verificationScrollRef}
            contentContainerStyle={styles.verificationPageContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summaryGrid}>
              <SummaryCard label="Total Records" value={String(combinedRows.length)} />
              <SummaryCard label="Pending Sync" value={String(queuedRecords.length)} />
              <SummaryCard label="Synced" value={String(verificationHistory.length)} />
              <SummaryCard label="Entry Mode" value={entryMethod === 'CAMERA_OCR' ? 'Camera' : 'Manual'} />
            </View>

            <View style={styles.card}>
              <View style={styles.formTitleRow}>
                <View>
                  <Text style={styles.title}>Verify a Part</Text>
                  <Text style={styles.formSubText}>Scan or manually enter the part number.</Text>
                </View>
                <TouchableOpacity style={styles.scanPartButton} onPress={openPartScanner}>
                  <Text style={styles.scanPartIcon}>▣</Text>
                  <Text style={styles.scanPartButtonText}>Scan</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Part Number</Text>
              <TextInput
                style={styles.input}
                value={verificationPart}
                onChangeText={(value) => {
                  setVerificationPart(value);
                  setEntryMethod('MANUAL');
                }}
                placeholder="Enter or scan part number"
                placeholderTextColor="#8a948f"
                autoCapitalize="characters"
              />

              <Text style={styles.label}>Physical Quantity</Text>
              <TextInput
                style={styles.input}
                value={verificationQty}
                onChangeText={(value) => setVerificationQty(value.replace(/[^0-9.]/g, ''))}
                placeholder="Enter physical quantity"
                placeholderTextColor="#8a948f"
                keyboardType="decimal-pad"
              />

              <Text style={styles.label}>Location</Text>
              <TextInput
                style={styles.input}
                value={verificationLocation}
                onChangeText={setVerificationLocation}
                placeholder="Example: A-01-02"
                placeholderTextColor="#8a948f"
                autoCapitalize="characters"
              />

              <Text style={styles.label}>Remark (optional)</Text>
              <TextInput
                style={[styles.input, styles.multilineInput]}
                value={verificationRemark}
                onChangeText={setVerificationRemark}
                placeholder="Optional remark"
                placeholderTextColor="#8a948f"
                multiline
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.primaryButton, submittingVerification && styles.disabledButton]}
                onPress={submitVerification}
                disabled={submittingVerification}
              >
                {submittingVerification ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Submit Verification</Text>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.verificationHistoryHeader}>
              <View>
                <Text style={styles.sectionTitleNoMargin}>Verified Stock</Text>
                <Text style={styles.historySubtitle}>Local queue and synced history for this branch</Text>
              </View>
              <TouchableOpacity style={styles.countBadge} onPress={manualRetrySync}>
                <Text style={styles.countBadgeText}>{combinedRows.length}</Text>
              </TouchableOpacity>
            </View>

            {verificationLoading && (
              <View style={styles.inlineLoadingRow}>
                <ActivityIndicator color={GREEN} />
                <Text style={styles.inlineLoadingText}>Loading verification history...</Text>
              </View>
            )}

            {!!verificationError && <ErrorBox message={verificationError} onRetry={() => loadVerificationData()} />}

            {!verificationLoading && combinedRows.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No verification records yet.</Text>
              </View>
            )}

            {combinedRows.map((item) => (
              <View key={item.id} style={styles.verificationRowCard}>
                <View style={styles.verificationRowTop}>
                  <View style={styles.partNumberWrap}>
                    <Text style={styles.verificationPartNo}>{item.partNo}</Text>
                    <Text style={styles.verificationTime}>{item.time}</Text>
                  </View>
                  <View style={item.pending ? styles.acceptedByOtherBadge : styles.verifiedBadge}>
                    <Text style={item.pending ? styles.acceptedByOtherText : styles.verifiedBadgeText}>{item.status}</Text>
                  </View>
                </View>
                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailCellLabel}>QUANTITY</Text>
                    <Text style={styles.detailCellValue}>{item.qty}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailCellLabel}>LOCATION</Text>
                    <Text style={styles.detailCellValue}>{item.location}</Text>
                  </View>
                </View>
                {!!item.remark && (
                  <View style={styles.remarkBox}>
                    <Text style={styles.remarkLabel}>REMARK</Text>
                    <Text style={styles.remarkText}>{item.remark}</Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  };

  const SearchScreen = () => (
    <View style={styles.flex}>
      <Header title="Stock Search" subtitle="BRANCH AVAILABILITY" />
      <OfflineBanner />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>Search Parts</Text>
            <Text style={styles.description}>Enter one or multiple part numbers separated by space, comma, or new line.</Text>

            <TextInput
              style={[styles.input, styles.searchInput]}
              value={searchText}
              onChangeText={setSearchText}
              placeholder={'86510-A0010\n92101-B4000'}
              placeholderTextColor="#8a948f"
              autoCapitalize="characters"
              multiline
              textAlignVertical="top"
            />

            <TouchableOpacity style={[styles.primaryButton, searchLoading && styles.disabledButton]} onPress={runStockSearch} disabled={searchLoading}>
              {searchLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.primaryButtonText}>Search Stock</Text>}
            </TouchableOpacity>
          </View>

          {!!searchError && <ErrorBox message={searchError} onRetry={runStockSearch} />}

          {searchResults.length > 0 && (
            <View style={styles.resultsWrap}>
              <Text style={styles.sectionTitle}>Search Results</Text>
              {searchResults.map((item, idx) => (
                <View key={`${item.part_number}-${idx}`} style={styles.stockCard}>
                  <Text style={styles.stockPartNo}>{item.part_number}</Text>
                  <Text style={styles.stockName}>{item.part_name}</Text>
                  <View style={styles.stockBottomRow}>
                    <Text style={styles.stockQty}>Available: {item.quantity ?? '—'}</Text>
                    <Text style={styles.stockLocation}>LOC: {item.location || '—'}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {searchNotFound.length > 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>Not found: {searchNotFound.join(', ')}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );

  // ==================== ROOT RENDER ====================

  if (booting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <BootingScreen />
      </SafeAreaView>
    );
  }

  if (screen === 'update-required') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={BG} />
        <UpdateRequiredScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle={screen === 'scanner' || screen === 'partScanner' ? 'light-content' : 'dark-content'} backgroundColor={screen === 'scanner' || screen === 'partScanner' ? '#000000' : BG} />

      {screen === 'pairEntry' && PairEntryScreen()}
      {screen === 'pairingOptions' && PairingOptionsScreen()}
      {screen === 'scanner' && ScannerScreen()}
      {screen === 'manual' && ManualPairingScreen()}
      {screen === 'success' && SuccessScreen()}
      {screen === 'home' && HomeScreen()}
      {screen === 'notifications' && NotificationsScreen()}
      {screen === 'requestDetail' && RequestDetailScreen()}
      {screen === 'verification' && VerificationScreen()}
      {screen === 'partScanner' && PartScannerScreen()}
      {screen === 'search' && SearchScreen()}
    </SafeAreaView>
  );
}

function SummaryCard({ label, value }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function MenuCard({ icon, title, description, onPress }) {
  return (
    <TouchableOpacity style={styles.menuCard} onPress={onPress}>
      <View style={styles.menuIconBox}>
        <Text style={styles.menuIcon}>{icon}</Text>
      </View>
      <View style={styles.menuContent}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDescription}>{description}</Text>
      </View>
      <Text style={styles.menuArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: BG },

  registrationContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 70,
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  formContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 150,
  },
  listContent: {
    padding: 18,
    paddingBottom: 50,
  },
  logoContainer: { alignItems: 'center', marginBottom: 24 },
  brandLogo: { width: 150, height: 150, marginBottom: 6 },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 23,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  logoText: { color: '#fff', fontSize: 27, fontWeight: '900' },
  appName: { marginTop: 12, color: '#1d2924', fontSize: 25, fontWeight: '900' },
  appSubtitle: {
    marginTop: 3,
    color: '#66736d',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },

  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#dce3df',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#edf3f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { marginTop: -4, color: GREEN, fontSize: 34 },
  headerTextWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#1d2924', fontSize: 17, fontWeight: '900' },
  headerSubtitle: {
    marginTop: 2,
    color: GREEN,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  headerSpacer: { width: 42 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 21,
    borderWidth: 1,
    borderColor: '#dce3df',
    elevation: 4,
  },
  title: { color: '#1c2923', fontSize: 22, fontWeight: '900' },
  description: {
    marginTop: 8,
    marginBottom: 21,
    color: '#68736e',
    fontSize: 14,
    lineHeight: 21,
  },
  centerTitle: {
    color: '#1c2923',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  centerDescription: {
    marginTop: 9,
    marginBottom: 22,
    color: '#68736e',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  label: {
    marginBottom: 7,
    color: '#33413a',
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    minHeight: 54,
    marginBottom: 17,
    paddingHorizontal: 15,
    color: '#1d2924',
    backgroundColor: '#f6f8f7',
    borderWidth: 1,
    borderColor: '#d5ddd9',
    borderRadius: 14,
    fontSize: 15,
  },
  mobileRow: { flexDirection: 'row', marginBottom: 22 },
  countryCodeBox: {
    width: 66,
    height: 54,
    marginRight: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8efeb',
    borderWidth: 1,
    borderColor: '#d5ddd9',
    borderRadius: 14,
  },
  countryCodeText: { color: '#2e3d35', fontSize: 15, fontWeight: '800' },
  mobileInput: {
    flex: 1,
    height: 54,
    paddingHorizontal: 15,
    color: '#1d2924',
    backgroundColor: '#f6f8f7',
    borderWidth: 1,
    borderColor: '#d5ddd9',
    borderRadius: 14,
    fontSize: 15,
  },
  multilineInput: { minHeight: 95, paddingTop: 14 },
  searchInput: { minHeight: 120, paddingTop: 14 },

  primaryButton: {
    minHeight: 55,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 15,
  },
  primaryButtonWide: {
    width: '100%',
    minHeight: 55,
    marginTop: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 15,
  },
  smallPrimaryButton: {
    flex: 1,
    minHeight: 46,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 13,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  secondaryButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf4f0',
    borderWidth: 1,
    borderColor: '#bcd3c6',
    borderRadius: 15,
  },
  secondaryButtonText: { color: GREEN, fontSize: 14, fontWeight: '900' },
  outlineButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#b9c8c0',
    borderRadius: 13,
  },
  outlineButtonText: { color: '#59665f', fontWeight: '900' },
  disabledButton: { opacity: 0.65 },
  loadingButtonText: { marginLeft: 10, color: '#fff', fontWeight: '900' },
  buttonIcon: { marginRight: 9, color: '#fff', fontSize: 20 },

  userSummary: {
    marginBottom: 21,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f2f6f4',
    borderRadius: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d8e9df',
    borderRadius: 14,
  },
  avatarText: { color: GREEN, fontSize: 18, fontWeight: '900' },
  userDetails: { flex: 1 },
  userName: { color: '#26332d', fontSize: 15, fontWeight: '900' },
  userMobile: { marginTop: 3, color: '#6c7771', fontSize: 13 },

  orRow: { marginVertical: 18, flexDirection: 'row', alignItems: 'center' },
  line: { flex: 1, height: 1, backgroundColor: '#dde3e0' },
  orText: { marginHorizontal: 12, color: '#89928e', fontSize: 12, fontWeight: '800' },
  footerText: {
    marginTop: 22,
    color: '#78837e',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },

  codeInput: {
    height: 62,
    marginBottom: 23,
    paddingHorizontal: 13,
    color: '#1d2924',
    backgroundColor: '#f5f8f6',
    borderWidth: 2,
    borderColor: '#bcd3c6',
    borderRadius: 15,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  textButton: { marginTop: 15, padding: 10, alignItems: 'center' },
  textButtonLabel: { color: GREEN, fontSize: 14, fontWeight: '900' },

  scannerScreen: { flex: 1, backgroundColor: '#000' },
  scannerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.34)' },
  scannerTop: {
    paddingHorizontal: 18,
    paddingTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scannerBackButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 14,
  },
  scannerBackText: { marginTop: -4, color: '#fff', fontSize: 34 },
  scannerTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  scannerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 255, height: 255, position: 'relative' },
  corner: {
    width: 55,
    height: 55,
    position: 'absolute',
    borderColor: '#fff',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: 18,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: 18,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: 18,
  },
  bottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderBottomRightRadius: 18,
  },
  scanInstruction: {
    maxWidth: 290,
    marginTop: 28,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
  },
  scannerBottom: { paddingBottom: 35, alignItems: 'center' },
  manualLinkButton: { padding: 12 },
  manualLinkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  processingText: { marginTop: 14, color: '#fff', fontSize: 15, fontWeight: '800' },

  centerScreen: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },
  loadingText: { marginTop: 14, color: '#68736e' },

  successScreen: {
    flex: 1,
    paddingHorizontal: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },
  successCircle: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 46,
    elevation: 5,
  },
  successCheck: { color: '#fff', fontSize: 48, fontWeight: '800' },
  successTitle: { marginTop: 24, color: '#1d2924', fontSize: 26, fontWeight: '900' },
  successDescription: { marginTop: 8, color: '#68736e', fontSize: 14, textAlign: 'center' },
  successDetails: {
    width: '100%',
    marginTop: 25,
    padding: 18,
    backgroundColor: '#fff',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#dce3df',
  },
  successLine: { color: '#26332d', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  successCode: {
    marginTop: 10,
    color: GREEN,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },

  homeContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 45 },
  homeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  homeWelcome: { color: '#718078', fontSize: 13, fontWeight: '700' },
  homeUserName: { marginTop: 3, color: '#1c2923', fontSize: 23, fontWeight: '900' },
  homeAvatar: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 16,
  },
  homeAvatarText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  homeBrandCard: {
    marginTop: 22,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dce3df',
    borderRadius: 20,
    elevation: 3,
  },
  homeLogoBox: {
    width: 53,
    height: 53,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 17,
  },
  homeLogoText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  homeBrandDetails: { flex: 1, marginLeft: 13 },
  homeBrandTitle: { color: '#1d2924', fontSize: 16, fontWeight: '900' },
  homeBrandSubtitle: { marginTop: 4, color: '#78837e', fontSize: 11 },
  activeBadge: { paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#dff1e7', borderRadius: 10 },
  activeBadgeText: { color: GREEN, fontSize: 9, fontWeight: '900' },

  sectionTitle: {
    marginTop: 25,
    marginBottom: 12,
    color: '#29372f',
    fontSize: 16,
    fontWeight: '900',
  },
  menuCard: {
    minHeight: 82,
    marginBottom: 13,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dce3df',
    borderRadius: 18,
    elevation: 2,
  },
  menuIconBox: {
    width: 49,
    height: 49,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e1eee7',
    borderRadius: 15,
  },
  menuIcon: { color: GREEN, fontSize: 22, fontWeight: '900' },
  menuContent: { flex: 1, marginLeft: 14 },
  menuTitle: { color: '#25332c', fontSize: 15, fontWeight: '900' },
  menuDescription: { marginTop: 4, color: '#79847e', fontSize: 11, lineHeight: 16 },
  menuArrow: { color: GREEN, fontSize: 30 },
  resetButton: { marginTop: 10, paddingVertical: 14, alignItems: 'center' },
  resetButtonText: { color: '#8a5d5d', fontSize: 12, fontWeight: '800' },

  requestCard: {
    marginBottom: 14,
    padding: 17,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dce3df',
  },
  requestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestNumber: { color: '#26332d', fontSize: 14, fontWeight: '900' },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#e1eee7', borderRadius: 9 },
  statusBadgeText: { color: GREEN, fontSize: 9, fontWeight: '900' },
  requestBranch: { marginTop: 12, color: '#3a4740', fontSize: 14, fontWeight: '800' },
  requestMeta: { marginTop: 5, color: '#7a857f', fontSize: 12 },
  actionRow: { marginTop: 16, flexDirection: 'row' },

  resultsWrap: { marginTop: 2 },
  stockCard: {
    marginBottom: 12,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#dce3df',
  },
  stockPartNo: { color: GREEN, fontSize: 15, fontWeight: '900' },
  stockName: { marginTop: 5, color: '#35423b', fontSize: 13, fontWeight: '700' },
  stockBottomRow: { marginTop: 13, flexDirection: 'row', justifyContent: 'space-between' },
  stockQty: { color: '#27352d', fontSize: 12, fontWeight: '900' },
  stockLocation: { color: '#68766e', fontSize: 12, fontWeight: '800' },
  helperText: { marginTop: 18, color: '#7b8780', fontSize: 12, textAlign: 'center' },

  verificationPageContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 160,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  summaryCard: {
    width: '48.5%',
    minHeight: 88,
    marginBottom: 12,
    padding: 15,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dce3df',
    borderRadius: 17,
    elevation: 2,
  },
  summaryValue: {
    color: GREEN,
    fontSize: 25,
    fontWeight: '900',
  },
  summaryLabel: {
    marginTop: 6,
    color: '#6e7a73',
    fontSize: 11,
    fontWeight: '800',
  },
  formTitleRow: {
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formSubText: {
    marginTop: 5,
    color: '#748078',
    fontSize: 12,
  },
  scanPartButton: {
    minWidth: 78,
    height: 46,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3f0e8',
    borderWidth: 1,
    borderColor: '#b9d2c3',
    borderRadius: 14,
  },
  scanPartIcon: {
    marginRight: 7,
    color: GREEN,
    fontSize: 17,
    fontWeight: '900',
  },
  scanPartButtonText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '900',
  },
  verificationHistoryHeader: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleNoMargin: {
    color: '#29372f',
    fontSize: 17,
    fontWeight: '900',
  },
  historySubtitle: {
    marginTop: 4,
    color: '#7a867f',
    fontSize: 11,
  },
  countBadge: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 12,
  },
  countBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  verificationRowCard: {
    marginBottom: 13,
    padding: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dce3df',
    borderRadius: 18,
    elevation: 2,
  },
  verificationRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  partNumberWrap: {
    flex: 1,
  },
  verificationPartNo: {
    color: '#1f2d26',
    fontSize: 15,
    fontWeight: '900',
  },
  verificationTime: {
    marginTop: 4,
    color: '#87918c',
    fontSize: 10,
    fontWeight: '700',
  },
  verifiedBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: '#dff1e7',
    borderRadius: 10,
  },
  verifiedBadgeText: {
    color: GREEN,
    fontSize: 9,
    fontWeight: '900',
  },
  detailGrid: {
    marginTop: 14,
    flexDirection: 'row',
  },
  detailCell: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f4f7f5',
    borderRadius: 12,
    marginRight: 8,
  },
  detailCellLabel: {
    color: '#859089',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  detailCellValue: {
    marginTop: 5,
    color: '#26342c',
    fontSize: 14,
    fontWeight: '900',
  },
  remarkBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#edf4f0',
    borderRadius: 12,
  },
  remarkLabel: {
    color: GREEN,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  remarkText: {
    marginTop: 5,
    color: '#55625b',
    fontSize: 12,
    lineHeight: 17,
  },
  partScanFrame: {
    width: 310,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  partScanHint: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
  },
  partScannerBottom: {
    paddingBottom: 34,
    alignItems: 'center',
  },
  captureButton: {
    width: 74,
    height: 74,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 37,
  },
  captureInner: {
    width: 56,
    height: 56,
    backgroundColor: '#ffffff',
    borderRadius: 28,
  },

  ocrProcessingText: {
    marginBottom: 6,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },


  offlineBanner: {
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#8a5d2b',
  },
  offlineBannerText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  pendingBadge: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fff3d6',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e7c977',
  },
  pendingBadgeText: { color: '#8a6a1f', fontSize: 11, fontWeight: '900' },
  scopeRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  scopePill: {
    marginRight: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#eef3f0',
    borderRadius: 10,
  },
  scopePillText: { color: '#3c4a43', fontSize: 11, fontWeight: '800' },
  errorBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fdeceb',
    borderWidth: 1,
    borderColor: '#f2b8b3',
    borderRadius: 16,
  },
  errorText: { color: '#8a3a34', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#176b43',
    borderRadius: 12,
  },
  retryButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  emptyBox: { marginTop: 30, alignItems: 'center' },
  emptyText: { color: '#7b8780', fontSize: 13, textAlign: 'center' },
  centerLoadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  acceptedByOtherBadge: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f4e3d2',
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  acceptedByOtherText: { color: '#8a5d2b', fontSize: 11, fontWeight: '900' },
  updateScreen: {
    flex: 1,
    paddingHorizontal: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1ef',
  },
  updateCard: {
    width: '100%',
    padding: 22,
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dce3df',
  },
  updateTitle: { color: '#1d2924', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  updateDescription: {
    marginTop: 10,
    color: '#5b6863',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  updateNote: {
    marginTop: 16,
    color: '#8a948f',
    fontSize: 11,
    textAlign: 'center',
  },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  syncRowText: { color: '#5c6862', fontSize: 11, fontWeight: '700' },
  inlineLoadingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 30, justifyContent: 'center' },
  inlineLoadingText: { marginLeft: 10, color: '#68736e', fontSize: 13 },
});
