import type { Plugin } from 'unified';
import type { Root } from 'mdast';

interface DirectiveLikeNode {
  type: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: DirectiveLikeNode[];
}

function walk(node: DirectiveLikeNode, visit: (n: DirectiveLikeNode) => void) {
  visit(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, visit);
  }
}

export const remarkCallout: Plugin<[], Root> = () => (tree) => {
  walk(tree as unknown as DirectiveLikeNode, (node) => {
    if (node.type !== 'containerDirective' || node.name !== 'callout') return;
    const attrs = node.attributes ?? {};
    const data = node.data ?? (node.data = {});
    data.hName = 'callout';
    data.hProperties = {
      'data-tone': attrs.type ?? 'info',
      'data-title': attrs.title ?? '',
    };
  });
};
