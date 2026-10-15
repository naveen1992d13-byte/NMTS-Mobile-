#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(rel, names) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/^export /gm, '');
  const sandbox = { module: { exports: {} }, exports: {}, console };
  vm.runInNewContext(`${src}\nmodule.exports = { ${names.join(', ')} };`, sandbox);
  return sandbox.module.exports;
}

const { isAgingStock, parseAgingDays, isActionableAutoTask } = load('src/utils/stockHelpers.js', ['isAgingStock', 'parseAgingDays', 'isActionableAutoTask']);

function revealedSystemQty(task, local) {
  if (local?.finalized || local?.verified) {
    if (local?.systemQty != null && local.systemQty !== '') return local.systemQty;
  }
  if (task?.count_saved) return task.system_qty;
  return null;
}

assert.strictEqual(revealedSystemQty({ system_qty: 40, count_saved: false }, null), null);
assert.strictEqual(revealedSystemQty({ system_qty: 40, count_saved: true }, null), 40);
assert.strictEqual(revealedSystemQty({ system_qty: 40 }, { verified: true, systemQty: 9 }), 9);

assert.strictEqual(isAgingStock({ purchaseAging: 120, salesAging: 10 }, 90), true);
assert.strictEqual(isAgingStock({ purchaseAging: 20, salesAging: 8 }, 90), false);
assert.strictEqual(parseAgingDays('-'), null);

const appJs = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
assert.ok(appJs.includes('VoiceTypeButton'), 'physical verification has Voice Type');
assert.ok(!appJs.includes('<VoiceTypeButton') || appJs.includes('onAppend={appendVoice}'), 'voice append wiring');
const autoScreen = fs.readFileSync(path.join(__dirname, '..', 'src/components/AutoPerpetualScreen.js'), 'utf8');
assert.ok(!autoScreen.includes('VoiceTypeButton'), 'Voice Type is not on Auto Perpetual');
assert.ok(autoScreen.includes('Blind Physical Count'), 'blind count copy present');
assert.ok(autoScreen.includes("Today's session is not created yet"), 'today-not-created copy present');
assert.ok(autoScreen.includes('PREVIOUS SESSIONS'), 'collapsed previous session cards present');
assert.ok(autoScreen.includes('Re-audit'), 're-audit control present');
assert.ok(autoScreen.includes('onOpenToday={undefined}'), 'expired cards do not open historical read-only list');
assert.ok(autoScreen.includes("onOpenSession?.(item, 'reaudit')"), 'expired card invokes re-audit');
assert.ok(!autoScreen.includes("Yesterday's session"), 'does not treat yesterday as today');
assert.ok(autoScreen.includes('ACTIONABLE PARTS'), 'actionable list copy present');

assert.strictEqual(isActionableAutoTask({ status: 'pending', quantity_finalized: false }), true, 'pending is actionable');
assert.strictEqual(isActionableAutoTask({ status: 'pending', quantity_finalized: false, count_saved: true }), true, 'saved-not-submitted remains');
assert.strictEqual(isActionableAutoTask({ status: 'completed', quantity_finalized: true }), false, 'submitted disappears');
assert.strictEqual(isActionableAutoTask({ status: 'pending' }, { finalized: true }), false, 'local finalized disappears');
assert.strictEqual(isActionableAutoTask({ status: 'pending', system_qty: 0, quantity_finalized: false }), true, 'zero live qty still shown');
const avail = fs.readFileSync(path.join(__dirname, '..', 'src/components/StockAvailabilityScreen.js'), 'utf8');
assert.ok(avail.includes('VoiceTypeButton'), 'parts search has Voice Type');
assert.ok(avail.includes('onAppend={appendVoice}'), 'parts search appends without search');
assert.ok(!avail.includes('onAppend={onSearch}'), 'voice does not bind search');

console.log('auto-perpetual-client: pass');
