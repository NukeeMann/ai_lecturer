'use client';

import type { CSSProperties } from 'react';
import { Download, FileText } from 'lucide-react';

import { ZoomableImage } from '@/components/ZoomableImage';

import type { CodeInput, CodeOutputMedia } from '../Code/schema';

const sectionLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const ioRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  background: 'var(--bg-subtle)',
  borderBottom: '1px solid var(--border)',
};

const ioHalfStyle: CSSProperties = {
  flex: '1 1 50%',
  minWidth: 0,
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const ioHalfWithDividerStyle: CSSProperties = {
  ...ioHalfStyle,
  borderRight: '1px solid var(--border)',
};

const inputsPanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const inputsListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const IO_MEDIA_MAX_PX = 220;
const IO_OUTPUT_MAX_PX = 220;

const inputMediaStyle: CSSProperties = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: `min(100%, ${IO_MEDIA_MAX_PX}px)`,
  maxHeight: `${IO_MEDIA_MAX_PX}px`,
  objectFit: 'contain',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const inputCaptionStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  marginTop: 4,
};

const fileCardStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  textDecoration: 'none',
  color: 'var(--text)',
  fontSize: 'var(--fs-sm)',
  width: 'fit-content',
  maxWidth: '100%',
};

const fileCardFilenameStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const textInputBoxStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const textInputLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--text-tertiary)',
  marginBottom: 4,
  display: 'block',
};

const outputMediaWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
};

const outputMediaStyle: CSSProperties = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: `min(100%, ${IO_OUTPUT_MAX_PX}px)`,
  maxHeight: `${IO_OUTPUT_MAX_PX}px`,
  objectFit: 'contain',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

interface InputsPanelProps {
  inputs: CodeInput[];
}

function InputsPanel({ inputs }: InputsPanelProps) {
  if (inputs.length === 0) return null;
  return (
    <div data-codewidget-inputs style={inputsPanelStyle}>
      <span style={sectionLabelStyle}>Inputs</span>
      <div style={inputsListStyle}>
        {inputs.map((input, i) => (
          <InputItem key={i} input={input} index={i} />
        ))}
      </div>
    </div>
  );
}

function InputItem({ input, index }: { input: CodeInput; index: number }) {
  if (input.kind === 'image') {
    return (
      <figure
        data-codewidget-input
        data-input-kind="image"
        data-input-index={index}
        style={{ margin: 0 }}
      >
        <ZoomableImage
          src={input.src}
          alt={input.alt ?? ''}
          style={inputMediaStyle}
          imgProps={{ 'data-codewidget-input-img': '' }}
        />
        {input.caption && (
          <figcaption style={inputCaptionStyle}>{input.caption}</figcaption>
        )}
      </figure>
    );
  }
  if (input.kind === 'video') {
    return (
      <figure
        data-codewidget-input
        data-input-kind="video"
        data-input-index={index}
        style={{ margin: 0 }}
      >
        <video
          data-codewidget-input-video
          src={input.src}
          controls
          style={inputMediaStyle}
        />
        {input.caption && (
          <figcaption style={inputCaptionStyle}>{input.caption}</figcaption>
        )}
      </figure>
    );
  }
  if (input.kind === 'file') {
    return (
      <div
        data-codewidget-input
        data-input-kind="file"
        data-input-index={index}
      >
        <a
          data-codewidget-input-file
          href={input.src}
          download={input.filename}
          style={fileCardStyle}
        >
          <FileText
            size={18}
            aria-hidden
            style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
          />
          <span style={fileCardFilenameStyle}>{input.filename}</span>
          <Download
            size={14}
            aria-hidden
            style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
          />
        </a>
        {input.caption && (
          <div style={inputCaptionStyle}>{input.caption}</div>
        )}
      </div>
    );
  }
  return (
    <div
      data-codewidget-input
      data-input-kind="text"
      data-input-index={index}
    >
      {input.label && <span style={textInputLabelStyle}>{input.label}</span>}
      <pre data-codewidget-input-text style={textInputBoxStyle}>
        {input.content}
      </pre>
    </div>
  );
}

interface OutputMediaBlockProps {
  media: CodeOutputMedia;
  /**
   * When provided, overrides `media.src` for the rendered `<img>` (image
   * variant only). Caption + alt stay as authored. Used by the live-capture
   * path to swap in a blob URL of the user's matplotlib figure (US-174).
   */
  displaySrc?: string;
  /**
   * Placeholder caption shown when `media.kind === 'image'`, `live` is true,
   * and no live PNG has rendered yet (US-174).
   */
  placeholderCaption?: string;
}

function OutputMediaBlock({ media, displaySrc, placeholderCaption }: OutputMediaBlockProps) {
  const imgSrc = media.kind === 'image' ? displaySrc ?? media.src : media.src;
  const showPlaceholderCaption =
    media.kind === 'image' && !displaySrc && Boolean(placeholderCaption);
  return (
    <div data-codewidget-output-media data-media-kind={media.kind} style={outputMediaWrapStyle}>
      <span style={sectionLabelStyle}>Output media</span>
      {media.kind === 'image' ? (
        <ZoomableImage
          src={imgSrc}
          alt={media.alt ?? ''}
          style={outputMediaStyle}
          imgProps={{
            'data-codewidget-output-img': '',
            'data-codewidget-output-img-live': displaySrc ? 'true' : 'false',
          }}
        />
      ) : (
        <video
          data-codewidget-output-video
          src={media.src}
          controls
          style={outputMediaStyle}
        />
      )}
      {showPlaceholderCaption && (
        <span data-codewidget-output-placeholder style={inputCaptionStyle}>
          {placeholderCaption}
        </span>
      )}
      {media.caption && <span style={inputCaptionStyle}>{media.caption}</span>}
    </div>
  );
}

export interface IORowProps {
  inputs: CodeInput[];
  outputMedia?: CodeOutputMedia;
  outputDisplaySrc?: string;
  outputPlaceholderCaption?: string;
}

export function IORow({
  inputs,
  outputMedia,
  outputDisplaySrc,
  outputPlaceholderCaption,
}: IORowProps) {
  const hasInputs = inputs.length > 0;
  const hasOutput = Boolean(outputMedia);
  if (!hasInputs && !hasOutput) return null;
  const splitBoth = hasInputs && hasOutput;
  return (
    <div data-codewidget-io-row style={ioRowStyle}>
      {hasInputs && (
        <div
          data-codewidget-io-half
          data-io-side="input"
          style={splitBoth ? ioHalfWithDividerStyle : ioHalfStyle}
        >
          <InputsPanel inputs={inputs} />
        </div>
      )}
      {hasOutput && outputMedia && (
        <div
          data-codewidget-io-half
          data-io-side="output"
          style={ioHalfStyle}
        >
          <OutputMediaBlock
            media={outputMedia}
            displaySrc={outputDisplaySrc}
            placeholderCaption={outputPlaceholderCaption}
          />
        </div>
      )}
    </div>
  );
}
