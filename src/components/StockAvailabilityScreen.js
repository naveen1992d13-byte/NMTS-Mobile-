import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BLUE, BORDER, DARK, MUTED } from '../theme';
import { Empty, Header, PrimaryButton, SecondaryButton, SquareButton, StockResultCard } from './ui';

const THRESHOLDS = [30, 60, 90, 120, 180];

export default function StockAvailabilityScreen({
  onBack,
  input,
  setInput,
  onSearch,
  onScan,
  onOpenMulti,
  results,
  notFound,
  busy,
  agingThreshold,
  setAgingThreshold,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus?.(), 350);
    return () => clearTimeout(timer);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
    >
      <Header title="Stock Availability" onBack={onBack} />

      <View style={styles.searchPanel}>
        <Text style={styles.sectionLabel}>SEARCH PART NO / DESCRIPTION</Text>
        <View style={styles.inlineInputRow}>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={input}
            onChangeText={setInput}
            placeholder="e.g. 26300"
            placeholderTextColor="#8793a6"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={onSearch}
          />
          <SquareButton title="▣" onPress={onScan} />
        </View>
        <View style={styles.actionRow}>
          <SecondaryButton title="Multiple Search" onPress={onOpenMulti} />
          <PrimaryButton title="Search" onPress={onSearch} busy={busy} compact />
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 14 }]}>AGING THRESHOLD</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thresholdRow}>
          {THRESHOLDS.map((days) => {
            const active = agingThreshold === days;
            return (
              <TouchableOpacity
                key={days}
                style={[styles.thresholdChip, active && styles.thresholdChipActive]}
                onPress={() => setAgingThreshold(days)}
              >
                <Text style={[styles.thresholdText, active && styles.thresholdTextActive]}>{days}d</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.hint}>Values above {agingThreshold} days are highlighted.</Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.results}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.resultHeader}>
          <Text style={styles.sectionLabel}>RESULTS ({results.length})</Text>
          {busy ? <ActivityIndicator color={BLUE} /> : null}
        </View>
        {results.length === 0 && !busy ? (
          <Empty text="Type a prefix or part number above to search." />
        ) : (
          results.map((row) => (
            <StockResultCard key={`${row.partNumber}-${row.systemLocation}`} row={row} agingThreshold={agingThreshold} />
          ))
        )}
        {notFound?.length ? (
          <View style={styles.notFoundBox}>
            <Text style={styles.notFoundTitle}>Not Found: {notFound.length}</Text>
            {notFound.map((part) => (
              <Text key={part} style={styles.notFoundItem}>{part}</Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchPanel: {
    padding: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sectionLabel: { marginBottom: 8, color: DARK, fontSize: 11, fontWeight: '900' },
  inlineInputRow: { flexDirection: 'row', alignItems: 'center' },
  searchInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: '#fafcff',
    color: DARK,
  },
  actionRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center' },
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
  hint: { marginTop: 8, color: MUTED, fontSize: 11 },
  results: { padding: 14, paddingBottom: 40 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notFoundBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#fff',
  },
  notFoundTitle: { color: DARK, fontWeight: '900', marginBottom: 8 },
  notFoundItem: { color: MUTED, fontSize: 12, marginBottom: 4 },
});
