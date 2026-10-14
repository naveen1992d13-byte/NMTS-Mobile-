/**
 * Normalize a final speech-recognition result for part-number Voice Type.
 * Append the returned string to the existing field; do not re-normalize
 * characters the user typed manually.
 */
const ENGLISH_NUMBERS = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  naught: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const ENGLISH_LETTERS = {
  a: 'A',
  ay: 'A',
  bee: 'B',
  be: 'B',
  see: 'C',
  sea: 'C',
  cee: 'C',
  dee: 'D',
  ee: 'E',
  e: 'E',
  ef: 'F',
  eff: 'F',
  gee: 'G',
  aitch: 'H',
  haitch: 'H',
  i: 'I',
  eye: 'I',
  jay: 'J',
  kay: 'K',
  ell: 'L',
  el: 'L',
  em: 'M',
  en: 'N',
  pee: 'P',
  queue: 'Q',
  cue: 'Q',
  que: 'Q',
  are: 'R',
  ess: 'S',
  es: 'S',
  tee: 'T',
  tea: 'T',
  you: 'U',
  vee: 'V',
  w: 'W',
  doubleu: 'W',
  ex: 'X',
  why: 'Y',
  zed: 'Z',
  zee: 'Z',
};

const TAMIL_NUMBERS = {
  'பூஜ்ஜியம்': '0',
  'பூஜ்யம்': '0',
  'சுழியம்': '0',
  'பூச்சியம்': '0',
  'ஒன்று': '1',
  'ஒன்னு': '1',
  'இரண்டு': '2',
  'ரெண்டு': '2',
  'மூன்று': '3',
  'மூனு': '3',
  'நான்கு': '4',
  'நாலு': '4',
  'ஐந்து': '5',
  'அஞ்சு': '5',
  'ஆறு': '6',
  'ஏழு': '7',
  'எட்டு': '8',
  'ஒன்பது': '9',
};

function foldToken(token) {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, '');
}

function mapToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const folded = foldToken(raw);
  if (TAMIL_NUMBERS[raw] != null) return TAMIL_NUMBERS[raw];
  if (TAMIL_NUMBERS[folded] != null) return TAMIL_NUMBERS[folded];
  if (ENGLISH_NUMBERS[folded] != null) return ENGLISH_NUMBERS[folded];
  if (folded === 'doubleu' || folded === 'double-u' || folded === 'doubleyou') return 'W';
  if (ENGLISH_LETTERS[folded] != null) return ENGLISH_LETTERS[folded];
  if (/^[0-9]+$/.test(raw)) return raw;
  if (/^[a-zA-Z]$/.test(raw)) return raw.toUpperCase();
  if (/^[a-zA-Z0-9]+$/.test(raw)) return raw.toUpperCase();
  return '';
}

function tokenize(spoken) {
  return String(spoken || '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeVoicePartNumber(spoken) {
  const tokens = tokenize(spoken);
  const out = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const folded = foldToken(tokens[index]);
    if ((folded === 'double' || folded === 'triple') && index + 1 < tokens.length) {
      const mapped = mapToken(tokens[index + 1]);
      if (mapped) {
        out.push(mapped.repeat(folded === 'triple' ? 3 : 2));
        index += 1;
        continue;
      }
    }
    const mapped = mapToken(tokens[index]);
    if (mapped) out.push(mapped);
  }
  return out.join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function appendVoiceToPartNumber(currentValue, spoken) {
  return `${String(currentValue || '')}${normalizeVoicePartNumber(spoken)}`;
}
