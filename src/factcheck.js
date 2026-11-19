// Fact check. Every figure, percentage, date or commitment in an outbound
// message must be traceable to a file. Anything that isn't is flagged as
// fabricated, with the claimed value shown next to the real value + source line.
import { readDataFile } from './config.js';

const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function toNumber(word) {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}
function quoteLine(content, index) {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  return content.slice(start, end).trim();
}

// --- extract claims from the outbound text ---------------------------------
// Returns [{ type, value, raw, context }]
export function extractClaims(text) {
  const claims = [];
  // percentages
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    claims.push({ type: 'percent', value: parseFloat(m[1]), raw: m[0], context: around(text, m.index) });
  }
  // day counts ("moved by 5 days", "5 days")
  for (const m of text.matchAll(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?/gi)) {
    const v = toNumber(m[1]);
    if (v !== null) claims.push({ type: 'days', value: v, raw: m[0], context: around(text, m.index) });
  }
  // money amounts (SGD 5,250 / 5,250 / $5,250) — require a currency or total-ish context
  for (const m of text.matchAll(/(?:SGD|\$)\s*([\d,]+(?:\.\d+)?)/gi)) {
    claims.push({ type: 'amount', value: parseFloat(m[1].replace(/,/g, '')), raw: m[0], context: around(text, m.index) });
  }
  // bare totals ("Total stands at 5,250", "stands at 5,250")
  for (const m of text.matchAll(/(?:total|stands|amount|invoice|settle|match|price|offer)[^.]*?\b([\d,]{3,}(?:\.\d+)?)\b/gi)) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (!claims.some((c) => c.type === 'amount' && c.value === v)) {
      claims.push({ type: 'amount', value: v, raw: m[1], context: around(text, m.index) });
    }
  }
  return claims;
}

function around(text, index) {
  const start = Math.max(0, text.lastIndexOf('.', index - 1) + 1);
  let end = text.indexOf('.', index);
  if (end === -1) end = text.length;
  return text.slice(start, end).trim();
}

// --- extract source facts from the task's files ----------------------------
// Returns [{ type, value, file, line, quote }]
export function extractSourceFacts(files) {
  const facts = [];
  for (const file of files) {
    let content;
    try { content = readDataFile(file); } catch { continue; }
    // surcharge percent
    for (const m of content.matchAll(/surcharge of (\d+(?:\.\d+)?)\s*%/gi)) {
      facts.push({ type: 'percent', value: parseFloat(m[1]), file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
    // invoice total
    for (const m of content.matchAll(/\*\*Total\*\*\s*\|\s*\*\*([\d,]+(?:\.\d+)?)\*\*/gi)) {
      facts.push({ type: 'amount', subtype: 'total', value: parseFloat(m[1].replace(/,/g, '')), file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
    // surcharge amount line
    for (const m of content.matchAll(/surcharge[^|\n]*\|\s*([\d,]+(?:\.\d+)?)/gi)) {
      facts.push({ type: 'amount', subtype: 'surcharge', value: parseFloat(m[1].replace(/,/g, '')), file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
    // deadline moved by N days
    for (const m of content.matchAll(/moved by (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?/gi)) {
      const v = toNumber(m[1]);
      if (v !== null) facts.push({ type: 'days', value: v, file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
    // deadline moved to a date
    for (const m of content.matchAll(/deadline moved to (\d{1,2}\s+\w+)/gi)) {
      facts.push({ type: 'date', value: m[1], file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
    // quoted fee / floor amounts (SGD N)
    for (const m of content.matchAll(/(?:Fee(?: quoted)?|floor is|below SGD|settle at|match(?: it)?[^.]*?at)\s*(?:SGD\s*)?([\d,]+(?:\.\d+)?)/gi)) {
      facts.push({ type: 'amount', subtype: 'fee', value: parseFloat(m[1].replace(/,/g, '')), file, line: lineOf(content, m.index), quote: quoteLine(content, m.index) });
    }
  }
  return facts;
}

// --- compare claims to source facts ----------------------------------------
// Returns [{ claimed, real, source_file, source_line, source_quote, status }]
// status: 'ok' | 'fabricated' (no source) | 'contradicted' (source says otherwise)
export function factCheck(text, sourceFiles) {
  const claims = extractClaims(text);
  const facts = extractSourceFacts(sourceFiles);
  const results = [];
  for (const claim of claims) {
    const sameType = facts.filter((f) => f.type === claim.type);
    if (claim.type === 'amount') {
      // prefer a total/fee fact for a total-ish claim
      const match = sameType.find((f) => f.value === claim.value);
      if (match) {
        results.push({ claimed: claim.raw, real: match.value, source_file: match.file, source_line: match.line, source_quote: match.quote, status: 'ok' });
        continue;
      }
      // A claim about a total is contradicted by the real total first, then a
      // fee, then any other amount on file.
      const contradict = sameType.find((f) => f.subtype === 'total')
        || sameType.find((f) => f.subtype === 'fee')
        || sameType[0];
      if (contradict) {
        results.push({ claimed: claim.raw, real: contradict.value, source_file: contradict.file, source_line: contradict.line, source_quote: contradict.quote, status: 'contradicted' });
      } else {
        results.push({ claimed: claim.raw, real: null, source_file: null, source_line: null, source_quote: null, status: 'fabricated' });
      }
      continue;
    }
    const match = sameType.find((f) => f.value === claim.value);
    if (match) {
      results.push({ claimed: claim.raw, real: match.value, source_file: match.file, source_line: match.line, source_quote: match.quote, status: 'ok' });
    } else if (sameType.length) {
      const contradict = sameType[0];
      results.push({ claimed: claim.raw, real: contradict.value, source_file: contradict.file, source_line: contradict.line, source_quote: contradict.quote, status: 'contradicted' });
    } else {
      results.push({ claimed: claim.raw, real: null, source_file: null, source_line: null, source_quote: null, status: 'fabricated' });
    }
  }
  return results;
}

export function hasFabrication(results) {
  return results.some((r) => r.status === 'fabricated' || r.status === 'contradicted');
}