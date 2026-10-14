#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/^export /gm, '');
  const sandbox = { module: { exports: {} }, exports: {}, console };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(`${src}\nmodule.exports = { normalizeVoicePartNumber, appendVoiceToPartNumber };`, sandbox);
  return sandbox.module.exports;
}

const { normalizeVoicePartNumber, appendVoiceToPartNumber } = load('src/utils/voiceNormalize.js');

const cases = [
  ['360 1 2', '36012'],
  ['360 0 1 2', '360012'],
  ['1 2 A', '12A'],
  ['four two zero A', '420A'],
  ['zero', '0'],
  ['oh', '0'],
  ['double one', '11'],
  ['triple five', '555'],
];

for (const [input, expected] of cases) {
  assert.strictEqual(normalizeVoicePartNumber(input), expected, `${input} -> ${expected}`);
}

assert.strictEqual(appendVoiceToPartNumber('360', '1 2'), '36012');
assert.strictEqual(appendVoiceToPartNumber('AB', 'zero'), 'AB0');
assert.strictEqual(normalizeVoicePartNumber('360-1,2!'), '36012');
assert.strictEqual(normalizeVoicePartNumber('ஒன்று இரண்டு'), '12');

console.log('voice-normalize: pass');
