import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BORDER, CARD_SOLID, MUTED, NEON_CYAN, NEON_YELLOW, TEXT, WARNING } from '../theme';

export default function IncomingRequestPopup({ visible, alert, onOpenRequest, onSnooze }) {
  if (!alert) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSnooze}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.kicker}>INCOMING REQUEST</Text>
          <Text style={styles.requestNo}>{alert.request_number || '—'}</Text>

          <View style={styles.row}>
            <Text style={styles.label}>From Dealer / Branch</Text>
            <Text style={styles.value}>
              {alert.from_dealer} / {alert.from_branch}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>To Dealer / Branch</Text>
            <Text style={styles.value}>
              {alert.to_dealer} / {alert.to_branch}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaBox}>
              <Text style={styles.label}>Items / Qty</Text>
              <Text style={styles.metaValue}>
                {alert.total_items || 0} / {alert.total_qty || 0}
              </Text>
            </View>
            <View style={styles.metaBox}>
              <Text style={styles.label}>SLA remaining</Text>
              <Text style={[styles.metaValue, styles.sla]}>{alert.sla_label || '—'}</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.snooze} onPress={onSnooze}>
              <Text style={styles.snoozeText}>SNOOZE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.open} onPress={onOpenRequest}>
              <Text style={styles.openText}>OPEN REQUEST</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    borderRadius: 22,
    backgroundColor: CARD_SOLID,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: NEON_CYAN,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 12,
  },
  kicker: { color: NEON_YELLOW, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  requestNo: { marginTop: 8, marginBottom: 16, color: TEXT, fontSize: 22, fontWeight: '900' },
  row: { marginBottom: 12 },
  label: { color: MUTED, fontSize: 11, fontWeight: '800' },
  value: { marginTop: 4, color: TEXT, fontSize: 14, fontWeight: '800' },
  metaRow: { flexDirection: 'row', marginTop: 4, marginBottom: 18 },
  metaBox: { flex: 1 },
  metaValue: { marginTop: 4, color: TEXT, fontSize: 16, fontWeight: '900' },
  sla: { color: WARNING },
  actions: { flexDirection: 'row' },
  snooze: {
    flex: 1,
    minHeight: 48,
    marginRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeText: { color: MUTED, fontWeight: '900' },
  open: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: NEON_CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openText: { color: '#041018', fontWeight: '900' },
});
