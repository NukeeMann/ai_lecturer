import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';

import { Callout, type CalloutTone } from '@/components/Callout';

import { remarkCallout } from './remarkCallout';
import type { TheoryData } from './schema';

export interface TheoryWidgetProps {
  data: TheoryData;
}

const VALID_TONES: ReadonlySet<CalloutTone> = new Set(['info', 'insight', 'warning', 'danger']);

function preprocessMath(markdown: string): string {
  return markdown
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$${body}$$`);
}

function normalizeTone(raw: unknown): CalloutTone {
  if (typeof raw === 'string' && VALID_TONES.has(raw as CalloutTone)) {
    return raw as CalloutTone;
  }
  return 'info';
}

const components: Components = {
  // Custom directive output ('callout' is not a standard HTML tag — react-markdown
  // accepts string keys at runtime; the cast keeps TypeScript happy).
  ...({
    callout: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const tone = normalizeTone(props['data-tone']);
      const titleAttr = props['data-title'];
      const title =
        typeof titleAttr === 'string' && titleAttr.length > 0 ? titleAttr : undefined;
      return (
        <Callout tone={tone} title={title}>
          {children}
        </Callout>
      );
    },
  } as Partial<Components>),
};

export function TheoryWidget({ data }: TheoryWidgetProps) {
  const markdown = preprocessMath(data.markdown);
  return (
    <div data-theory-body>
      <ReactMarkdown
        remarkPlugins={[remarkDirective, remarkCallout, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
