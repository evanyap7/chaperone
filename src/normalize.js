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

// Full legal-name normalisation: NFKC + confusable folding, lower-case,
// punctuation (.,()- etc.) to spaces, collapsed whitespace. Legal suffixes
// (pte, ltd, llc) are kept — they are part of the name, not noise.
export function normalizeName(text) {
  return normalizeText(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
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

// "five thousand two hundred and fifty" -> 5250, "5 thousand 8 hundred" ->
// 5800, "eighty" -> 80. Digit tokens are accepted alongside number words.
// Returns null if not a number.
export function wordsToNumber(phrase) {
  let total = 0; let group = 0; let current = 0; let found = false;
  for (const word of String(phrase).toLowerCase().split(/[\s-]+/)) {
    if (!word || word === 'and') continue;
    if (/^\d[\d,]*$/.test(word)) { current += parseInt(word.replace(/,/g, ''), 10); found = true; }
    else if (ONES[word] !== undefined) { current += ONES[word]; found = true; }
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

// Any Unicode decimal digit (\p{Nd}: Arabic-Indic, Devanagari, fullwidth, ...)
// becomes its ASCII equivalent. Each digit block's zero is found by stepping
// back at most 9 codepoints while the previous codepoint is also Nd — O(1)
// per character, so the whole pass is linear.
const ND_RE = /\p{Nd}/gu;
const IS_ND = /\p{Nd}/u;
function asciiDigits(t) {
  return t.replace(ND_RE, (ch) => {
    if (ch <= '\u007F') return ch; // ASCII 0-9 fast path
    const cp = ch.codePointAt(0);
    let zero = cp;
    for (let k = 0; k < 9 && IS_ND.test(String.fromCodePoint(zero - 1)); k++) zero--;
    return String(cp - zero);
  });
}

const isDigitCh = (c) => c >= '0' && c <= '9';
const isLetterCh = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isWordCh = (c) => c !== undefined && (isLetterCh(c) || isDigitCh(c) || c === '_');
const NUMBER_WORD_SET = new Set([...Object.keys(ONES), ...Object.keys(TENS), 'hundred', 'thousand', 'million']);
const isNumberWord = (w) => NUMBER_WORD_SET.has(w); // 'and' is a connector, never a start

// Single-pass tokenizer: maximal digit runs (with commas and one decimal
// part) and maximal letter runs. Everything else is a separator. Linear.
function moneyTokens(t) {
  const tokens = [];
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (isDigitCh(ch)) {
      const start = i;
      i++;
      while (i < t.length && (isDigitCh(t[i]) || t[i] === ',')) i++;
      if (t[i] === '.' && isDigitCh(t[i + 1])) {
        i++;
        while (i < t.length && isDigitCh(t[i])) i++;
      }
      tokens.push({ type: 'digit', text: t.slice(start, i), start, end: i });
    } else if (isLetterCh(ch)) {
      const start = i;
      while (i < t.length && isLetterCh(t[i])) i++;
      tokens.push({ type: 'word', text: t.slice(start, i), start, end: i });
    } else {
      i++;
    }
  }
  return tokens;
}

// Every money-ish figure in a text: digits with commas / k / m suffixes
// ("5.8k", "6M", "5k8" -> 5800), number words, and mixed digit+word numbers
// ("5 thousand 8 hundred" -> ONE value 5800). Years ("2026") and hyphenated
// identifiers ("2026-036") are not amounts. Returns [{ value, raw }].
//
// Hand-written single-pass scanner: no regex with nested unbounded
// quantifiers over number words, so pathological inputs stay linear-time.
export function extractMoney(text) {
  const t = asciiDigits(normalizeText(text));
  const tokens = moneyTokens(t);
  const out = [];
  const push = (value, raw) => { if (Number.isFinite(value)) out.push({ value, raw }); };
  const gap = (a, b) => t.slice(a.end, b.start);
  const wordSep = (g) => g.length > 0 && /^[\s-]+$/.test(g);
  const suffixSep = (g) => /^\s*$/.test(g);
  const after = (tok) => t[tok.end];
  const before = (tok) => (tok.start > 0 ? t[tok.start - 1] : undefined);
  const blockedAfter = (c) => c !== undefined && (isDigitCh(c) || c === '-');

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'digit') {
      const b = before(tok);
      if (b !== undefined && (isDigitCh(b) || b === '.' || b === '-')) { i++; continue; }
      // k / m suffix (optionally after whitespace), then "5k8" shorthand.
      const nx = tokens[i + 1];
      if (nx && nx.type === 'word' && /^[km]$/i.test(nx.text) && suffixSep(gap(tok, nx))) {
        const sAfter = after(nx);
        if (nx.text.toLowerCase() === 'k' && sAfter !== undefined && isDigitCh(sAfter)) {
          const trail = tokens[i + 2];
          if (trail && trail.type === 'digit' && trail.start === nx.end && /^\d{1,3}$/.test(trail.text) && !blockedAfter(after(trail))) {
            push(num(tok.text) * 1000 + parseInt(trail.text, 10) * 10 ** (3 - trail.text.length), t.slice(tok.start, trail.end));
            i += 3;
            continue;
          }
        }
        if (!blockedAfter(sAfter)) {
          push(num(tok.text) * (nx.text.toLowerCase() === 'k' ? 1e3 : 1e6), t.slice(tok.start, nx.end));
          i += 2;
          continue;
        }
        // A digit or hyphen right after the suffix invalidates it: fall
        // through to the bare number (which is valid before a letter).
      }
      if (blockedAfter(after(tok))) { i++; continue; }
      // Mixed digit+word number: "5 thousand 8 hundred" is ONE value.
      let end = i;
      let merged = false;
      for (let k = i + 1; k < tokens.length; k++) {
        const cand = tokens[k];
        if (!wordSep(gap(tokens[end], cand))) break;
        if (cand.type === 'word' && isNumberWord(cand.text.toLowerCase())) { end = k; merged = true; }
        else if (merged && cand.type === 'digit' && /^\d[\d,]*$/.test(cand.text) && !blockedAfter(after(cand))) { end = k; }
        else break;
      }
      if (merged) {
        const raw = t.slice(tok.start, tokens[end].end);
        const v = wordsToNumber(raw);
        if (v !== null && v > 0) push(v, raw);
        i = end + 1;
        continue;
      }
      if (/^(19|20)\d\d$/.test(tok.text)) { i++; continue; } // a bare year
      push(num(tok.text), tok.text);
      i++;
      continue;
    }
    if (tok.type === 'word' && isNumberWord(tok.text.toLowerCase()) && !isWordCh(before(tok))) {
      let end = i;
      for (let k = i + 1; k < tokens.length; k++) {
        const cand = tokens[k];
        if (!wordSep(gap(tokens[end], cand))) break;
        const w = cand.text.toLowerCase();
        if (cand.type === 'word' && (isNumberWord(w) || w === 'and')) { end = k; }
        else if (cand.type === 'digit' && /^\d[\d,]*$/.test(cand.text) && !blockedAfter(after(cand))) { end = k; }
        else break;
      }
      if (!isWordCh(after(tokens[end]))) {
        const raw = t.slice(tok.start, tokens[end].end);
        const v = wordsToNumber(raw);
        if (v !== null && v > 0) push(v, raw);
        i = end + 1;
        continue;
      }
    }
    i++;
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