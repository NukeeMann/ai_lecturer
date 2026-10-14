// Turns flashcard text (the same markdown-ish dialect lessons use: **bold**,
// *italic*, `code`, "- " lists, $inline$ / $$display$$ math) into the HTML
// Anki stores in note fields. Deliberately small — cards are one fact each,
// so anything richer than this is a sign the card should be split.
//
// Math goes to Anki's MathJax delimiters: $x$ → \(x\), $$x$$ → \[x\].
// Cloze markup ({{c1::…}}) passes through untouched.

const PLACEHOLDER = (i: number) => `\u0000${i}\u0000`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>');
}

export function markdownToAnkiHtml(input: string): string {
  const stash: string[] = [];
  const keep = (html: string) => {
    stash.push(html);
    return PLACEHOLDER(stash.length - 1);
  };

  let text = input.replace(/\r\n?/g, '\n').trim();
  // Order matters: code spans first so `$` inside code is not math, then
  // display math before inline math.
  text = text.replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => keep(`\\[${escapeHtml(m.trim())}\\]`));
  text = text.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (_, pre: string, m: string) =>
    `${pre}${keep(`\\(${escapeHtml(m)}\\)`)}`,
  );
  text = text.replace(/\\\$/g, '$');

  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    const item = bullet ?? numbered;
    if (item) {
      const tag = bullet ? 'ul' : 'ol';
      if (lines.length > 0) {
        out.push(lines.join('<br>'));
        lines.length = 0;
      }
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(inline(escapeHtml(item[1])));
      continue;
    }
    flushList();
    lines.push(inline(escapeHtml(raw)));
  }
  flushList();
  if (lines.length > 0) out.push(lines.join('<br>'));

  // Blank lines between paragraphs leave empty <br><br> runs; collapse them.
  return out
    .join('')
    .replace(/(<br>){3,}/g, '<br><br>')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => stash[Number(i)]);
}

// Anki's sort field / checksum are computed over the field text without HTML.
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}
