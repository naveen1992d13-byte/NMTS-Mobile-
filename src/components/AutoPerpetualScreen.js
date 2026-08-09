import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BLUE, BORDER, DARK, MUTED, SUCCESS, WARNING } from '../theme';
import { calculateVerification, numberValue } from '../utils/stockHelpers';
import { Empty, Header, PrimaryButton, SecondaryButton, StatusPill, SyncStatusBanner } from './ui';

function ProgressBar({ verified, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((verified / total) * 100)) : 0;
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressText}>Verified: {verified} / {total}</Text>
        <Text style={styles.progressPending}>Pending: {Math.max(0, total - verified)}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function TaskCard({ task, local, onPress }) {
  const verified = Boolean(local?.verified);
  const status = local?.status;
  const matched = status === 'MATCHED';
  const mismatch = verified && status && status !== 'MATCHED';

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        verified && matched && styles.taskCardMatched,
        verified && mismatch && styles.taskCardWarn,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.taskTopRow}>
          <Text style={styles.partNo}>{task.part_number}</Text>
          {verified ? <StatusPill value="VERIFIED" /> : null}
        </View>
        <Text style={styles.partName}>{task.part_name || '-'}</Text>
        <Text style={styles.meta}>
          LOC: {task.loc || '-'} · Sys: {task.system_qty ?? '-'}
          {task.coverage_kind === 'recheck' ? ' · RECHECK' : ''}
        </Text>
        {verified ? (
          <View style={styles.verifiedMeta}>
            <Text style={styles.verifiedLine}>Physical Qty: {local.physicalQty}</Text>
            <StatusPill value={status} />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

function VerifyModal({
  visible,
  task,
  physicalQty,
  setPhysicalQty,
  damageQty,
  setDamageQty,
  location,
  setLocation,
  remark,
  setRemark,
  onClose,
  onSave,
  busy,
}) {
  if (!task) return null;
  const diff = calculateVerification(task.system_qty, physicalQty, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Physical Verification</Text>
          <Text style={styles.partNo}>{task.part_number}</Text>
          <Text style={styles.partName}>{task.part_name || '-'}</Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>LOC</Text>
              <Text style={styles.infoValue}>{task.loc || '-'}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>System Qty</Text>
              <Text style={styles.infoValue}>{task.system_qty ?? 0}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Difference</Text>
              <Text style={styles.infoValue}>{diff.differenceQty}</Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Status</Text>
              <StatusPill value={diff.status} />
            </View>
          </View>

          <TextInput
            style={styles.input}
            value={physicalQty}
            onChangeText={(v) => setPhysicalQty(v.replace(/[^0-9.]/g, ''))}
            placeholder="Physical Qty"
            keyboardType="decimal-pad"
            placeholderTextColor="#8793a6"
            autoFocus
          />
          <View style={styles.twoCol}>
            <TextInput
              style={[styles.input, styles.half]}
              value={damageQty}
              onChangeText={(v) => setDamageQty(v.replace(/[^0-9.]/g, ''))}
              placeholder="Damage Qty"
              keyboardType="decimal-pad"
              placeholderTextColor="#8793a6"
            />
            <TextInput
              style={[styles.input, styles.half, { marginRight: 0 }]}
              value={location}
              onChangeText={setLocation}
              placeholder="Physical LOC"
              autoCapitalize="characters"
              placeholderTextColor="#8793a6"
            />
          </View>
          <TextInput
            style={styles.input}
            value={remark}
            onChangeText={setRemark}
            placeholder="Remark (optional)"
            placeholderTextColor="#8793a6"
          />

          <View style={styles.modalActions}>
            <SecondaryButton title="Cancel" onPress={onClose} />
            <PrimaryButton title="Save" onPress={onSave} busy={busy} compact />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AutoPerpetualScreen({
  onBack,
  sessionId,
  tasks,
  localVerified,
  assignedCount,
  completedCount,
  busy,
  syncStatus,
  onRefresh,
  onSaveLocal,
  onSubmitVerified,
  submitting,
}) {
  const [selected, setSelected] = useState(null);
  const [physicalQty, setPhysicalQty] = useState('');
  const [damageQty, setDamageQty] = useState('');
  const [location, setLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const totalAssigned = assignedCount || tasks.length;
  const localVerifiedCount = Object.keys(localVerified || {}).length;
  // Prefer server completed + local unsynced/not-yet-reflected verified cards.
  const verifiedCount = Math.max(completedCount || 0, localVerifiedCount);

  const unsyncedVerified = useMemo(
    () => Object.values(localVerified || {}).filter((row) => row.verified && !row.synced),
    [localVerified]
  );

  const openTask = (task) => {
    const existing = localVerified?.[task.part_number];
    setSelected(task);
    setPhysicalQty(existing ? String(existing.physicalQty) : '');
    setDamageQty(existing?.damageQty ? String(existing.damageQty) : '');
    setLocation(existing?.location || (task.loc && task.loc !== '-' ? task.loc : ''));
    setRemark(existing?.remark || '');
  };

  const closeModal = () => {
    setSelected(null);
    setPhysicalQty('');
    setDamageQty('');
    setLocation('');
    setRemark('');
  };

  const handleSave = async () => {
    if (!selected) return;
    if (physicalQty === '' || numberValue(physicalQty) < 0) return;
    setSaving(true);
    try {
      const diff = calculateVerification(selected.system_qty, physicalQty, 0);
      await onSaveLocal({
        task: selected,
        physicalQty: numberValue(physicalQty),
        damageQty: numberValue(damageQty),
        location: (location || selected.loc || '').trim().toUpperCase(),
        remark: remark.trim(),
        status: diff.status,
        differenceQty: diff.differenceQty,
      });
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Header title="Auto Perpetual" onBack={onBack} action="Refresh" onAction={onRefresh} />
      <SyncStatusBanner status={syncStatus} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>TODAY&apos;S SESSION</Text>
        <View style={styles.sessionCard}>
          <Text style={styles.sessionId}>{sessionId || 'Loading session…'}</Text>
          <Text style={styles.sessionSub}>Backend daily Auto Perpetual session (IST)</Text>
        </View>

        <ProgressBar verified={verifiedCount} total={totalAssigned || tasks.length} />

        <Text style={styles.sectionLabel}>ASSIGNED PARTS ({tasks.length})</Text>
        {busy && !tasks.length ? <ActivityIndicator color={BLUE} style={{ marginVertical: 20 }} /> : null}
        {!busy && tasks.length === 0 ? <Empty text="No Auto Perpetual tasks for today." /> : null}
        {tasks.map((task) => (
          <TaskCard
            key={`${task.part_number}-${task.id || ''}`}
            task={task}
            local={localVerified?.[task.part_number]}
            onPress={() => openTask(task)}
          />
        ))}
      </ScrollView>

      <View style={styles.stickyBar}>
        <PrimaryButton
          title={`Submit Verified Parts (${unsyncedVerified.length})`}
          onPress={onSubmitVerified}
          busy={submitting}
          disabled={!unsyncedVerified.length}
        />
      </View>

      <VerifyModal
        visible={Boolean(selected)}
        task={selected}
        physicalQty={physicalQty}
        setPhysicalQty={setPhysicalQty}
        damageQty={damageQty}
        setDamageQty={setDamageQty}
        location={location}
        setLocation={setLocation}
        remark={remark}
        setRemark={setRemark}
        onClose={closeModal}
        onSave={handleSave}
        busy={saving}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 14, paddingBottom: 120 },
  sectionLabel: { marginBottom: 10, color: DARK, fontSize: 11, fontWeight: '900' },
  sessionCard: {
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    marginBottom: 12,
  },
  sessionId: { color: DARK, fontSize: 16, fontWeight: '900' },
  sessionSub: { marginTop: 4, color: MUTED, fontSize: 11 },
  progressWrap: {
    marginBottom: 14,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressText: { color: DARK, fontWeight: '900', fontSize: 13 },
  progressPending: { color: MUTED, fontWeight: '800', fontSize: 12 },
  progressTrack: { height: 8, borderRadius: 8, backgroundColor: '#e8eef8', overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: SUCCESS },
  taskCard: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
  },
  taskCardMatched: { borderColor: '#9fd4b2', backgroundColor: '#f3fbf6' },
  taskCardWarn: { borderColor: '#f0d19a', backgroundColor: '#fffaf0' },
  taskTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  partNo: { color: DARK, fontSize: 14, fontWeight: '900' },
  partName: { marginTop: 3, color: MUTED, fontSize: 11 },
  meta: { marginTop: 7, color: '#4b5563', fontSize: 11 },
  verifiedMeta: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  verifiedLine: { color: SUCCESS, fontSize: 12, fontWeight: '800' },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 22 : 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
  },
  modalTitle: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  infoGrid: { marginTop: 14, marginBottom: 8, flexDirection: 'row', flexWrap: 'wrap' },
  infoCell: { width: '50%', paddingVertical: 8 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoValue: { marginTop: 3, color: DARK, fontWeight: '900' },
  input: {
    minHeight: 48,
    marginBottom: 9,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#fafcff',
    color: DARK,
  },
  twoCol: { flexDirection: 'row' },
  half: { flex: 1, marginRight: 8 },
  modalActions: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
});
