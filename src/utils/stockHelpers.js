export function normalizePartNumber(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 40);
}

export function splitPartNumbers(value) {
  return [...new Set(
    String(value || '')
      .split(/[\n\r,;]+|\s{2,}|\t+/)
      .flatMap((chunk) => {
        const cleaned = normalizePartNumber(chunk);
        if (cleaned) return [cleaned];
        // Allow single-space separated full part numbers when paste lacks newlines.
        return String(chunk || '')
          .split(/\s+/)
          .map(normalizePartNumber)
          .filter(Boolean);
      })
      .filter(Boolean)
  )];
}

export function getAvailableQuantity(item) {
  return Number(
    item?.available_quantity ??
      item?.available_qty ??
      item?.quantity ??
      item?.qty ??
      0
  );
}

export function parseAgingDays(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function calculateVerification(systemQuantity, physicalQuantity, unitValue = 0) {
  const systemQty = Number(systemQuantity || 0);
  const physicalQty = Number(physicalQuantity || 0);
  const value = Number(unitValue || 0);
  const difference = physicalQty - systemQty;

  return {
    systemQty,
    physicalQty,
    status: difference === 0 ? 'MATCHED' : difference < 0 ? 'SHORTAGE' : 'EXCESS',
    shortageQty: difference < 0 ? Math.abs(difference) : 0,
    excessQty: difference > 0 ? difference : 0,
    differenceQty: difference,
    differenceValue: Math.abs(difference) * value,
  };
}

export function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapStockRow(row = {}) {
  const availableQty = numberValue(
    row.available_quantity ?? row.available_qty ?? row.quantity ?? row.qty ?? row.available
  );
  const unitValue = numberValue(row.unit_value ?? row.part_value ?? row.value ?? row.mav);
  return {
    raw: row,
    partNumber: normalizePartNumber(row.part_number ?? row.partNumber ?? row.part_no ?? row.partNo),
    partName: row.part_name ?? row.partName ?? row.item_name ?? row.description ?? row.name ?? '-',
    systemQty: numberValue(row.system_quantity ?? row.system_qty ?? row.quantity ?? row.qty),
    availableQty,
    systemLocation: row.system_location ?? row.loc ?? row.location ?? row.pin_location ?? '-',
    unitValue,
    totalValue: availableQty * unitValue,
    category: row.part_category ?? row.category ?? '-',
    purchaseAging: row.purchase_aging_days ?? row.purchase_aging ?? row.purchaseAging ?? '-',
    salesAging: row.sales_aging_days ?? row.sales_aging ?? row.salesAging ?? '-',
    lastUpdated: row.last_updated ?? row.updated_at ?? row.uploaded_at ?? '-',
    status: availableQty > 0 ? 'AVAILABLE' : 'NOT AVAILABLE',
  };
}
