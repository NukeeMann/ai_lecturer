'use client';

// Shared inline Markdown + math renderer.
//
// Authored quiz / drag-match / parametric / table text uses the same
// `$…$` / `\(…\)` math (and light **markdown**) as Theory. Several widgets
// historically printed these fields as raw strings, so KaTeX showed literal
// dollar signs. This is the single place that pipeline lives now:
// remark-gfm + remark-math + rehype-katex + the same `preprocessMath`
// normalisation Theory uses.
//
// The auto `<p>` wrapper is unwrapped so the output stays inline inside flex
// rows, option buttons, table cells and slider labels — no block margins,
// existing layout untouched.

import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { preprocessMath } from '@/lib/client/mathPreprocess';

const inlineComponents: Components = {
  p: (({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )) as Components['p'],
};

export function MarkdownInline({ children }: { children: string }) {
  // Nothing to render (and ReactMarkdown dislikes non-strings) — bail early.
  if (typeof children !== 'string' || children.length === 0) {
    return <>{children}</>;
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inlineComponents}
    >
      {preprocessMath(children)}
    </ReactMarkdown>
  );
}

export default MarkdownInline;
