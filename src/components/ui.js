import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BLUE, BORDER, DANGER, DARK, MUTED, SUCCESS, WARNING } from '../theme';

export function Header({ title, onBack, action, onAction }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.back}>‹</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction}>
          <Text style={styles.headerAction}>{action}</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ width: 42 }} />
      )}
    </View>
  );
}

export function Field({ label, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#8793a6" {...props} />
    </View>
  );
}

export function PrimaryButton({ title, onPress, busy, disabled, compact }) {
  return (
    <TouchableOpacity
      style={[styles.primaryButton, compact && { flex: 1 }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={busy || disabled}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function SecondaryButton({ title, onPress, disabled }) {
  return (
    <TouchableOpacity style={[styles.secondaryButton, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <Text style={styles.secondaryText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function SquareButton({ title, onPress }) {
  return (
    <TouchableOpacity style={styles.squareButton} onPress={onPress}>
      <Text style={styles.squareButtonText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Empty({ text }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export function StatusPill({ value }) {
  const color =
    value === 'MATCHED' || value === 'ACCEPTED' || value === 'VERIFIED'
      ? SUCCESS
      : value === 'SHORTAGE' || value === 'PARTIAL'
        ? WARNING
        : DANGER;
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}18` }]}>
      <Text style={[styles.statusPillText, { color }]}>{value}</Text>
    </View>
  );
}

export function SyncStatusBanner({ status }) {
  if (!status?.message) return null;
  const ok = status.state === 'synced';
  return (
    <View style={[styles.syncBanner, ok && styles.syncBannerOk]}>
      <Text style={[styles.syncBannerText, ok && styles.syncBannerTextOk]}>{status.message}</Text>
    </View>
  );
}

export const AGING_THRESHOLDS = [30, 60, 90, 120, 180];

export function AgingBadge({ label, value, threshold }) {
  const days = typeof value === 'number' ? value : Number(String(value).match(/-?\d+(\.\d+)?/)?.[0]);
  const hot = Number.isFinite(days) && Number.isFinite(threshold) && days > threshold;
  return (
    <View style={[styles.agingBadge, hot && styles.agingBadgeHot]}>
      <Text style={[styles.agingLabel, hot && styles.agingLabelHot]}>{label}</Text>
      <Text style={[styles.agingValue, hot && styles.agingValueHot]}>{value ?? '-'}</Text>
    </View>
  );
}

/** Shared aging threshold chips for Single + Multiple Stock Availability search. */
export function AgingThresholdSelector({ value, onChange }) {
  return (
    <View>
      <Text style={styles.agingSectionLabel}>AGING THRESHOLD</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thresholdRow}>
        {AGING_THRESHOLDS.map((days) => {
          const active = value === days;
          return (
            <TouchableOpacity
              key={days}
              style={[styles.thresholdChip, active && styles.thresholdChipActive]}
              onPress={() => onChange(days)}
            >
              <Text style={[styles.thresholdText, active && styles.thresholdTextActive]}>{days}d</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={styles.agingHint}>Values above {value} days are highlighted.</Text>
    </View>
  );
}

export function StockResultCard({ row, agingThreshold = 90 }) {
  return (
    <View style={styles.stockCard}>
      <Text style={styles.rowPartNo}>{row.partNumber}</Text>
      <Text style={styles.rowPartName}>{row.partName}</Text>
      <View style={styles.stockMetaRow}>
        <View style={styles.stockMetaBlock}>
          <Text style={styles.infoLabel}>Available Qty</Text>
          <Text style={styles.stockQty}>{row.availableQty}</Text>
        </View>
        <View style={styles.stockMetaBlock}>
          <Text style={styles.infoLabel}>LOC / Bin</Text>
          <Text style={styles.infoValue}>{row.systemLocation}</Text>
        </View>
      </View>
      <View style={styles.agingRow}>
        <AgingBadge label="Purchase Aging" value={row.purchaseAging} threshold={agingThreshold} />
        <AgingBadge label="Sales Aging" value={row.salesAging} threshold={agingThreshold} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 58,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: DARK, fontSize: 38, lineHeight: 40 },
  headerTitle: { color: DARK, fontSize: 17, fontWeight: '900' },
  headerAction: { color: BLUE, fontSize: 12, fontWeight: '800' },
  label: { marginBottom: 7, color: DARK, fontSize: 12, fontWeight: '800' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 13,
    paddingHorizontal: 14,
    backgroundColor: '#fbfcff',
    color: DARK,
  },
  primaryButton: {
    minHeight: 50,
    paddingHorizontal: 18,
    borderRadius: 13,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '900' },
  secondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  secondaryText: { color: BLUE, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  squareButton: {
    width: 48,
    height: 48,
    marginLeft: 8,
    borderRadius: 12,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareButtonText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  empty: {
    padding: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyText: { color: MUTED },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  statusPillText: { fontSize: 9, fontWeight: '900' },
  syncBanner: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#edf3ff',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: 'center',
  },
  syncBannerOk: { backgroundColor: '#e8f8ee' },
  syncBannerText: { color: BLUE, fontSize: 12, fontWeight: '800' },
  syncBannerTextOk: { color: SUCCESS },
  stockCard: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
  },
  rowPartNo: { color: DARK, fontSize: 14, fontWeight: '900' },
  rowPartName: { marginTop: 3, color: MUTED, fontSize: 11 },
  stockMetaRow: { marginTop: 12, flexDirection: 'row' },
  stockMetaBlock: { flex: 1 },
  infoLabel: { color: MUTED, fontSize: 10, fontWeight: '700' },
  infoValue: { marginTop: 3, color: DARK, fontWeight: '900' },
  stockQty: { marginTop: 3, color: SUCCESS, fontSize: 16, fontWeight: '900' },
  agingRow: { marginTop: 12, flexDirection: 'row', gap: 8 },
  agingBadge: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f5f7fb',
    borderWidth: 1,
    borderColor: BORDER,
  },
  agingBadgeHot: { backgroundColor: '#fff1f1', borderColor: '#f0b4b4' },
  agingLabel: { color: MUTED, fontSize: 9, fontWeight: '700' },
  agingLabelHot: { color: DANGER },
  agingValue: { marginTop: 3, color: DARK, fontSize: 13, fontWeight: '900' },
  agingValueHot: { color: DANGER },
  agingSectionLabel: { marginBottom: 8, color: DARK, fontSize: 11, fontWeight: '900' },
  thresholdRow: { paddingRight: 8 },
  thresholdChip: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#f5f7fb',
  },
  thresholdChipActive: { backgroundColor: '#edf3ff', borderColor: BLUE },
  thresholdText: { color: MUTED, fontWeight: '800', fontSize: 12 },
  thresholdTextActive: { color: BLUE },
  agingHint: { marginTop: 8, color: MUTED, fontSize: 11 },
});
