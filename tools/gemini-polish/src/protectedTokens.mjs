// The safety crux. Mechanically extract the multiset of "protected" tokens
// (LaTeX, code, links/images incl. their URLs, bare URLs, "Rys. N") from a
// string. After polishing, the polished text MUST contain the exact same
// multiset — same tokens, same counts. Any difference => reject the polish.
//
// We blank out matched ranges as we go (replace with equal-length spaces) so a
// later, broader pattern can't re-match inside an already-claimed span. Order
// matters and is chosen so containers (code, links, images) are claimed before
// the narrower math/URL patterns that might otherwise split them.

const PATTERNS = [
  // 1. fenced code blocks ``` ... ``` (can contain anything, incl. $ and ])
  { name: 'fenced-code', re: /```[\s\S]*?```/g },
  // 2. inline code `...`
  { name: 'inline-code', re: /`[^`\n]+`/g },
  // 3. markdown images ![alt](url) — whole token (so alt AND url are frozen).
  // Alt may contain single-level [brackets] (axis units like "[m]", "[s]") —
  // a plain [^\]]* would stop at the first ] and leave the image UNPROTECTED.
  { name: 'image', re: /!\[(?:[^\[\]]|\[[^\[\]]*\])*\]\([^)\s]+\)/g },
  // 4. markdown links [text](url) — whole token (url frozen)
  { name: 'link', re: /\[(?:[^\[\]]|\[[^\[\]]*\])*\]\([^)\s]+\)/g },
  // 5. display math $$...$$
  { name: 'display-math', re: /\$\$[\s\S]*?\$\$/g },
  // 6. delimited display \[ ... \]
  { name: 'bracket-display-math', re: /\\\[[\s\S]*?\\\]/g },
  // 7. delimited inline \( ... \)
  { name: 'paren-inline-math', re: /\\\([\s\S]*?\\\)/g },
  // 8. inline math $...$ (single line, non-empty, paired)
  { name: 'inline-math', re: /\$(?!\$)[^\n$]+?\$/g },
  // 9. bare URLs
  { name: 'url', re: /\bhttps?:\/\/[^\s)]+/g },
  // 10. figure tokens "Rys. N" / "Rys.N"
  { name: 'figure', re: /\bRys\.\s*\d+\b/gi },
];

export function extractProtectedTokens(text) {
  if (typeof text !== 'string') return [];
  // Working copy we progressively blank out.
  let work = text;
  const tokens = [];
  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    const blanks = [];
    while ((m = re.exec(work)) !== null) {
      tokens.push(m[0]);
      blanks.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
    }
    // Blank claimed ranges so later patterns can't match inside them.
    if (blanks.length) {
      const arr = work.split('');
      for (const [s, e] of blanks) {
        for (let i = s; i < e; i++) arr[i] = ' ';
      }
      work = arr.join('');
    }
  }
  return tokens;
}

function toMultiset(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/**
 * Compare protected tokens of original vs polished.
 * Returns { ok, missing: [{token,count}], extra: [{token,count}] }
 *  - missing: tokens present in original but dropped/reduced in polished
 *  - extra:   tokens present in polished but absent/increased (i.e. altered/added)
 */
export function verifyProtectedTokens(original, polished) {
  const a = toMultiset(extractProtectedTokens(original));
  const b = toMultiset(extractProtectedTokens(polished));
  const missing = [];
  const extra = [];
  for (const [tok, ca] of a) {
    const cb = b.get(tok) || 0;
    if (cb < ca) missing.push({ token: tok, count: ca - cb });
  }
  for (const [tok, cb] of b) {
    const ca = a.get(tok) || 0;
    if (cb > ca) extra.push({ token: tok, count: cb - ca });
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

// ---- Masking: replace protected spans with ⟦N⟧ sentinels before sending to
// Gemini, restore them byte-for-byte on the way back. This makes it physically
// impossible for the model to corrupt code fences / math / images / figure
// numbers — it only ever sees the surrounding prose and opaque ⟦N⟧ tokens.

export function collectSpans(text) {
  if (typeof text !== 'string') return [];
  let work = text;
  const spans = [];
  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    const ranges = [];
    while ((m = re.exec(work)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      ranges.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) re.lastIndex++;
    }
    if (ranges.length) {
      const arr = work.split('');
      for (const [s, e] of ranges) for (let i = s; i < e; i++) arr[i] = ' ';
      work = arr.join('');
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/** Returns { masked, spans } — `masked` has ⟦i⟧ where span i was. */
export function maskProtected(text) {
  const spans = collectSpans(text);
  if (!spans.length) return { masked: text, spans: [] };
  let out = '';
  let pos = 0;
  const stored = [];
  spans.forEach((sp, i) => {
    out += text.slice(pos, sp.start) + `⟦${i}⟧`;
    stored.push(sp.text);
    pos = sp.end;
  });
  out += text.slice(pos);
  return { masked: out, spans: stored };
}

const SENT = /⟦\s*(\d+)\s*⟧/g;

/**
 * Restore ⟦i⟧ sentinels in `masked` with their original spans.
 * Returns { ok, text } or { ok:false, reason } if any sentinel is
 * dropped, duplicated, or out of range (i.e. the model mangled a placeholder).
 */
export function unmaskProtected(masked, spans) {
  const seen = new Map();
  let mm;
  SENT.lastIndex = 0;
  while ((mm = SENT.exec(masked)) !== null) {
    const i = Number(mm[1]);
    seen.set(i, (seen.get(i) || 0) + 1);
  }
  for (let i = 0; i < spans.length; i++) {
    const c = seen.get(i) || 0;
    if (c !== 1) return { ok: false, reason: `placeholder ⟦${i}⟧ wystąpił ${c}× (oczekiwano 1)` };
  }
  for (const [i] of seen) {
    if (i < 0 || i >= spans.length) return { ok: false, reason: `nieoczekiwany placeholder ⟦${i}⟧` };
  }
  const text = masked.replace(SENT, (_, d) => spans[Number(d)]);
  return { ok: true, text };
}

const CLIP = (s, n = 48) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
};

/** Short human-readable explanation of a verification failure for the report. */
export function summarizeDiff(diff) {
  const parts = [];
  for (const { token, count } of diff.missing) parts.push(`dropped/altered ${count}× \`${CLIP(token)}\``);
  for (const { token, count } of diff.extra) parts.push(`added/altered ${count}× \`${CLIP(token)}\``);
  return parts.join('; ');
}
