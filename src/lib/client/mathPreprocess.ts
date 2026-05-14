// Shared math preprocessor for ReactMarkdown + remark-math + rehype-katex
// pipelines. Behavior must stay byte-identical to the original TheoryWidget
// implementation:
//   - `\(...\)`     -> `$...$`         (inline math)
//   - `\[...\]`     -> `$$\n...\n$$`   (display math)
//   - `$$inline$$`  -> `$$\n...\n$$`   (single-line $$...$$ promoted to block)
//
// Theory and LessonChat both call this so model output that uses TeX-style
// delimiters renders consistently across widgets.
export function preprocessMath(markdown: string): string {
  return markdown
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$\n${body}\n$$`)
    .replace(/\$\$([^\n$]+?)\$\$/g, (_, body: string) => `$$\n${body}\n$$`);
}
