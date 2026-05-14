// US-186: strip markdown noise from a TheoryWidget body so the resulting
// prose feels natural when piped through TTS.
//
// Goals: drop code (fenced blocks + inline spans), images, math (replace with a
// single space so surrounding prose stays grammatical), and minimal markdown
// syntax (headers, bold, italic, links → keep visible text). NO full
// markdown-to-text dep — a small regex pass is sufficient for our content.

export function stripForTts(markdown: string): string {
  let out = markdown;

  // Fenced code blocks ```...``` (multi-line). Remove entirely.
  out = out.replace(/```[\s\S]*?```/g, '');

  // Display math $$...$$ (single or multi-line). Replace with a single space.
  out = out.replace(/\$\$[\s\S]+?\$\$/g, ' ');

  // LaTeX display math \[...\]. Replace with a single space.
  out = out.replace(/\\\[[\s\S]+?\\\]/g, ' ');

  // LaTeX inline math \(...\). Replace with a single space.
  out = out.replace(/\\\([\s\S]+?\\\)/g, ' ');

  // Inline math $...$ (no embedded $ or newline). Replace with a single space.
  out = out.replace(/\$[^$\n]+\$/g, ' ');

  // Images ![alt](src). Remove entirely.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Inline code spans `...`. Remove the span (including ticks).
  out = out.replace(/`[^`\n]+`/g, '');

  // Links [text](url) → text.
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Headers: leading 1-6 `#` markers at line start.
  out = out.replace(/^[ \t]{0,3}#{1,6}\s+/gm, '');

  // Bold **text** → text.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Italic _text_ → text. Constrain to word boundaries so we don't eat
  // underscores in identifiers like `my_var` (already inline-code-stripped above).
  out = out.replace(/(^|[^A-Za-z0-9])_([^_\n]+)_(?=$|[^A-Za-z0-9])/g, '$1$2');

  // Collapse runs of whitespace introduced by the substitutions, but preserve
  // paragraph breaks (\n\n) so TTS still pauses between paragraphs.
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]*\n[ \t]*/g, '\n');

  return out.trim();
}
