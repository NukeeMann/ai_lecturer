import type { Plugin } from 'unified';
import type { Root } from 'mdast';

interface DirectiveLikeNode {
  type: string;
  value?: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: DirectiveLikeNode[];
}

function isDirective(node: DirectiveLikeNode): boolean {
  return (
    node.type === 'textDirective' ||
    node.type === 'leafDirective' ||
    node.type === 'containerDirective'
  );
}

function directivePrefix(type: string): string {
  if (type === 'containerDirective') return ':::';
  if (type === 'leafDirective') return '::';
  return ':';
}

// `remark-directive` greedily parses any `:name`, `::name`, or `:::name` token,
// including false positives in regular prose like times ("17:23") or URLs
// ("example.com:8080"). Unhandled directives become block `<div>` elements via
// `remark-rehype`, which crashes hydration when they land inside a `<p>`. We
// keep `:::callout` as the only recognized directive and rewrite the rest back
// to literal text so they round-trip safely as inline content.
function neutralize(node: DirectiveLikeNode): DirectiveLikeNode[] {
  const literal = directivePrefix(node.type) + (node.name ?? '');
  const replacement: DirectiveLikeNode[] = [{ type: 'text', value: literal }];
  if (Array.isArray(node.children) && node.children.length > 0) {
    if (node.type === 'containerDirective') {
      replacement.push(...node.children);
    } else {
      replacement.push({ type: 'text', value: '[' });
      replacement.push(...node.children);
      replacement.push({ type: 'text', value: ']' });
    }
  }
  return replacement;
}

function transform(parent: DirectiveLikeNode): void {
  if (!Array.isArray(parent.children)) return;
  let i = 0;
  while (i < parent.children.length) {
    const node = parent.children[i];
    if (isDirective(node)) {
      if (node.type === 'containerDirective' && node.name === 'callout') {
        const attrs = node.attributes ?? {};
        const data = node.data ?? (node.data = {});
        data.hName = 'callout';
        data.hProperties = {
          'data-tone': attrs.type ?? 'info',
          'data-title': attrs.title ?? '',
        };
        transform(node);
        i++;
        continue;
      }
      const replacement = neutralize(node);
      parent.children.splice(i, 1, ...replacement);
      i += replacement.length;
      continue;
    }
    transform(node);
    i++;
  }
}

export const remarkCallout: Plugin<[], Root> = () => (tree) => {
  transform(tree as unknown as DirectiveLikeNode);
};
