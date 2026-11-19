// Shared text normalisation and similarity helpers.
// Adversaries reword, re-case, split words with zero-width characters, swap
// Cyrillic lookalikes, write money as "5.8k" or "five thousand eight hundred".
// Detection normalises first, so none of those disguises change the outcome.
import { orgKey } from './config.js';

// Cyrillic / Greek confusables that look like Latin letters.
const CONFUSABLES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'ԍ': 'g', 'օ': 'o',
  'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'У': 'Y', 'Х': 'X', 'І': 'I', 'Ѕ': 'S', 'Ј': 'J',
  'α': 'a', 'β': 'b', 'ε': 'e', 'ζ': 'z', 'η': 'h', 'ι': 'i', 'κ': 'k', 'μ': 'm', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'y', 'χ': 'x',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
};

// NFKC (full-width -> ASCII), strip zero-width / invisible characters, map
// lookalike letters to their Latin equivalents. Pure ASCII text is unchanged,
// so evidence quotes stay exact lines of the original files.
export function normalizeText(text) {
  let t = String(text ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
  t = t.replace(/[\u0400-\u04FF\u0370-\u03FF]/g, (ch) => CONFUSABLES[ch] || ch);
  return t;
}

const CURRENCY_WORDS = new Set(['sgd', 'usd', 'dollar', 'dollars', 's$']);

// Word tokens for similarity: normalised, lower-cased, punctuation split
// ("pre-money" -> "pre money", "5,250" -> "5 250"), currency words dropped.
export function tokens(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter((w) => w && !CURRENCY_WORDS.has(w));
}

export function shingles(text, n = 3) {
  const t = tokens(text);
  const out = new Set();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(' '));
  return out;
}

// Shared word 3-grams between two texts.
export function sharedShingles(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  return [...A].filter((s) => B.has(s));
}

// Content similarity: two shared 3-grams, or one shared 3-gram carrying a
// figure (figures are what make a paraphrase of confidential news distinctive).
export function isSimilar(text, source) {
  const shared = sharedShingles(text, source);
  return shared.length >= 2 || shared.some((s) => /\d/.test(s));
}

// --- money -----------------------------------------------------------------

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and)';
export const NUMBER_WORDS_RE = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})+\\b`, 'gi');

// "five thousand two hundred and fifty" -> 5250. Returns null if not a number.
export function wordsToNumber(phrase) {
  let total = 0; let group = 0; let current = 0; let found = false;
  for (const word of String(phrase).toLowerCase().split(/[\s-]+/)) {
    if (word === 'and') continue;
    if (ONES[word] !== undefined) { current += ONES[word]; found = true; }
    else if (TENS[word] !== undefined) { current += TENS[word]; found = true; }
    else if (word === 'hundred') { current = (current || 1) * 100; found = true; }
    else if (word === 'thousand') { group = (group + current) || 1; total += group * 1000; group = 0; current = 0; found = true; }
    else if (word === 'million') { group = (group + current) || 1; total += group * 1e6; group = 0; current = 0; found = true; }
    else return null;
  }
  if (!found) return null;
  return total + group + current;
}

const num = (s) => parseFloat(String(s).replace(/,/g, ''));

// Every money-ish figure in a text: digits with commas / k / m suffixes, and
// number words. Years ("2026") and hyphenated identifiers ("2026-036") are not
// amounts. Returns [{ value, raw }].
export function extractMoney(text) {
  const t = normalizeText(text);
  const out = [];
  for (const m of t.matchAll(/(?<![\d.-])(\d[\d,]*(?:\.\d+)?)\s*([km])?(?![\d-])/gi)) {
    if (!m[2] && /^(19|20)\d\d$/.test(m[1])) continue; // a bare year
    const v = num(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1);
    if (Number.isFinite(v)) out.push({ value: v, raw: m[0] });
  }
  for (const m of t.matchAll(NUMBER_WORDS_RE)) {
    const v = wordsToNumber(m[0]);
    if (v !== null && v > 0) out.push({ value: v, raw: m[0] });
  }
  return out;
}

// Normalise an invoice reference to a canonical data-relative path so "./x",
// "finance//x" and "FINANCE/X" all aggregate as the same invoice.
export function canonicalPath(rel, dataDir, pathMod) {
  try {
    const abs = pathMod.resolve(dataDir, rel);
    return pathMod.relative(dataDir, abs).split(pathMod.sep).join('/').toLowerCase();
  } catch {
    return String(rel).toLowerCase();
  }
}

export { orgKey };