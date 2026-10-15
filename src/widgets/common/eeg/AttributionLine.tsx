'use client';

// Credit line under every real figure/recording: text · licence · link.
// Restricted (private-use) material gets a lock icon + "Private use only".

import type { CSSProperties } from 'react';
import { ExternalLink, Lock } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';

import type { Attribution } from './figure';

export const PRIVATE_USE_TOOLTIP = 'Private use only — copyrighted material, do not share or publish';

export interface AttributionLineProps {
  attribution: Attribution;
  style?: CSSProperties;
}

export function AttributionLine({ attribution, style }: AttributionLineProps) {
  const { text, license, url, restricted } = attribution;
  return (
    <p
      data-eeg-attribution=""
      style={{
        margin: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '2px 6px',
        fontSize: 'var(--fs-xs)',
        lineHeight: 1.5,
        color: 'var(--text-tertiary)',
        overflowWrap: 'anywhere',
        minWidth: 0,
        ...style,
      }}
    >
      {restricted ? (
        <span
          title={PRIVATE_USE_TOOLTIP}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning)', fontWeight: 600 }}
        >
          <Lock size={11} aria-hidden />
          <span>Private use only</span>
        </span>
      ) : null}
      <span style={{ minWidth: 0 }}>
        <MarkdownInline>{text}</MarkdownInline>
      </span>
      <span aria-hidden>·</span>
      <span>{license}</span>
      {url ? (
        <>
          <span aria-hidden>·</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-secondary)' }}
          >
            Source
            <ExternalLink size={10} aria-hidden />
          </a>
        </>
      ) : null}
    </p>
  );
}

export default AttributionLine;
