// Quiz options are shuffled per mount and labelled A, B, C… by display
// position, but generated explanations often cite options by their authored
// 1-based number ("Opcje 1, 3 i 4 są poprawne", "Option 2 is a trap"). Those
// numbers point at the authored order, so after shuffling they no longer match
// what the learner sees. This rewrites such references to the displayed letter.
//
// Only numbers that directly follow an option keyword are rewritten (plus
// "(N)" markers when the explanation already uses keyword references), so
// unrelated numbers — "sin 0 = 0", "(0, 0, 1)", "Rys. 4" — stay untouched.

const KEYWORD =
  '(?:opcj[a-ząęy]*|wariant(?:y|u|ów|ach|ami|em|om)?|odpowied(?:ź|zi|zią|ziach|ziami|ziom)|options?|answers?|choices?)';
const SEP = '(?:\\s*,\\s*|\\s+(?:i|oraz|lub|albo|and|or)\\s+|\\s*,\\s*(?:i|oraz|lub|albo|and|or)\\s+)';
const LIST = `\\d+(?:${SEP}\\d+)*`;

const KEYWORD_LIST_RE = new RegExp(`(^|[^\\p{L}])(${KEYWORD})(\\s+)(${LIST})(?![\\d.,]\\d)`, 'giu');
const PAREN_MARKER_RE = /(^|[\s*_])\((\d+)\)(?=\s*[—–:\-])/g;

export function remapOptionRefs(
  explanation: string,
  displayOrder: readonly number[],
  letters: readonly string[],
): string {
  const n = displayOrder.length;
  const letterFor = (num: number): string | null => {
    if (!Number.isInteger(num) || num < 1 || num > n) return null;
    const pos = displayOrder.indexOf(num - 1);
    return pos === -1 ? null : (letters[pos] ?? null);
  };

  let usedKeyword = false;
  let out = explanation.replace(
    KEYWORD_LIST_RE,
    (match, lead: string, kw: string, gap: string, list: string) => {
      const nums = list.match(/\d+/g) ?? [];
      const mapped = nums.map((d) => letterFor(Number(d)));
      if (mapped.some((m) => m === null)) return match;
      usedKeyword = true;
      // A cited list is a set ("Opcje 1, 3 i 4"), so keep it alphabetical.
      mapped.sort();
      let i = 0;
      return `${lead}${kw}${gap}${list.replace(/\d+/g, () => mapped[i++] as string)}`;
    },
  );

  if (usedKeyword) {
    out = out.replace(PAREN_MARKER_RE, (match, lead: string, d: string) => {
      const letter = letterFor(Number(d));
      return letter === null ? match : `${lead}(${letter})`;
    });
  }
  return out;
}
