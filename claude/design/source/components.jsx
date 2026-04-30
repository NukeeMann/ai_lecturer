// AI Lecturer — Component Library
// All atoms used across screens, plus the widget container system.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// ICONS — lightweight Lucide-style strokes, 1.5px, currentColor
// ─────────────────────────────────────────────────────────────────────────────

const Icon = ({ name, size = 16, strokeWidth = 1.75, ...props }) => {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="M20 6L9 17l-5-5" />,
    chevronRight: <path d="M9 18l6-6-6-6" />,
    chevronLeft: <path d="M15 18l-6-6 6-6" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    chevronUp: <path d="M18 15l-6-6-6 6" />,
    x: <path d="M18 6L6 18M6 6l12 12" />,
    search: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></>,
    sparkles: <><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z" /><path d="M19 14l.7 2 2 .7-2 .7L19 19.5l-.7-2-2-.7 2-.7L19 14z" /><path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5L5 4z" /></>,
    play: <path d="M5 3l14 9-14 9V3z" />,
    pause: <><rect x="6" y="4" width="4" height="16" rx="0.5" /><rect x="14" y="4" width="4" height="16" rx="0.5" /></>,
    refresh: <><path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    moon: <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
    edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
    code: <><path d="M16 18l6-6-6-6" /><path d="M8 6l-6 6 6 6" /></>,
    flask: <><path d="M9 3h6M10 3v7L4.5 19a1 1 0 00.87 1.5h13.26a1 1 0 00.87-1.5L14 10V3" /></>,
    brain: <path d="M9.5 2A2.5 2.5 0 0012 4.5 2.5 2.5 0 0114.5 2 2.5 2.5 0 0117 4.5c0 .76-.34 1.44-.87 1.9.85.31 1.46 1.13 1.46 2.1 0 .65-.28 1.24-.73 1.65.6.51.99 1.27.99 2.12 0 .9-.43 1.69-1.1 2.19.06.27.1.55.1.84A3.5 3.5 0 0113.35 18 3.5 3.5 0 0110 21.5 3.5 3.5 0 016.5 18 3.5 3.5 0 013 14.5c0-.29.04-.57.1-.84A2.97 2.97 0 012 11.5c0-.85.39-1.61.99-2.12A2.42 2.42 0 012.26 7.7c0-.97.61-1.79 1.46-2.1A2.42 2.42 0 013 4.5 2.5 2.5 0 015.5 2 2.5 2.5 0 018 4.5 2.5 2.5 0 0010.5 2" />,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
    layout: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
    fileText: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
    bookOpen: <><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></>,
    folder: <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
    keyboard: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" /></>,
    save: <><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
    arrowRight: <><path d="M5 12h14M12 5l7 7-7 7" /></>,
    arrowLeft: <><path d="M19 12H5M12 19l-7-7 7-7" /></>,
    pencil: <><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
    trash: <><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /></>,
    grip: <><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>,
    info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
    alertTriangle: <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>,
    lightbulb: <><path d="M9 18h6M10 22h4M15 14a5 5 0 10-6 0v3h6v-3z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
    user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    bot: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4M8 16h.01M16 16h.01" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
    chart: <><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 6-6" /></>,
    layers: <><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5M2 12l10 5 10-5" /></>,
    eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24" /><path d="M1 1l22 22" /></>,
    panel: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
    panelRight: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></>,
    menu: <><path d="M3 12h18M3 6h18M3 18h18" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
    history: <><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></>,
    terminal: <><path d="M4 17l6-6-6-6M12 19h8" /></>,
    git: <><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6" /></>,
  };
  const path = paths[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
      {...props}
    >
      {path}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON
// ─────────────────────────────────────────────────────────────────────────────

const buttonStyles = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: 'var(--fs-sm)',
    lineHeight: 1,
    padding: '0 12px',
    height: '32px',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background var(--t-fast), border-color var(--t-fast), color var(--t-fast), transform var(--t-fast)',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    letterSpacing: '-0.005em',
  },
  primary: {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
  },
  secondary: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
  },
  danger: {
    background: 'var(--danger-subtle)',
    color: 'var(--danger)',
    border: '1px solid var(--danger-border)',
  },
};

const Button = ({ variant = 'secondary', size = 'md', leftIcon, rightIcon, children, kbd, style, ...props }) => {
  const sizeStyles = {
    sm: { height: '26px', padding: '0 8px', fontSize: 'var(--fs-xs)' },
    md: { height: '32px', padding: '0 12px', fontSize: 'var(--fs-sm)' },
    lg: { height: '40px', padding: '0 16px', fontSize: 'var(--fs-base)' },
  }[size];
  return (
    <button
      style={{ ...buttonStyles.base, ...buttonStyles[variant], ...sizeStyles, ...style }}
      onMouseEnter={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = 'var(--accent-hover)';
        else if (variant === 'secondary') { e.currentTarget.style.background = 'var(--bg-hover)'; }
        else if (variant === 'ghost') e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (variant === 'primary') e.currentTarget.style.background = 'var(--accent)';
        else if (variant === 'secondary') e.currentTarget.style.background = 'var(--bg-elevated)';
        else if (variant === 'ghost') e.currentTarget.style.background = 'transparent';
      }}
      {...props}
    >
      {leftIcon && <Icon name={leftIcon} size={size === 'sm' ? 12 : 14} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={size === 'sm' ? 12 : 14} />}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
};

const Kbd = ({ children, style }) => (
  <span style={{
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    background: 'color-mix(in srgb, currentColor 10%, transparent)',
    padding: '2px 5px',
    borderRadius: '4px',
    border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
    color: 'inherit',
    opacity: 0.85,
    lineHeight: 1,
    ...style,
  }}>{children}</span>
);

// ─────────────────────────────────────────────────────────────────────────────
// BADGE
// ─────────────────────────────────────────────────────────────────────────────

const Badge = ({ tone = 'neutral', size = 'md', children, dot, style }) => {
  const toneMap = {
    neutral: { bg: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: 'var(--border)' },
    accent: { bg: 'var(--accent-subtle)', color: 'var(--accent-text)', border: 'var(--accent-border)' },
    success: { bg: 'var(--success-subtle)', color: 'var(--success)', border: 'var(--success-border)' },
    warning: { bg: 'var(--warning-subtle)', color: 'var(--warning)', border: 'var(--warning-border)' },
    danger: { bg: 'var(--danger-subtle)', color: 'var(--danger)', border: 'var(--danger-border)' },
    insight: { bg: 'var(--insight-subtle)', color: 'var(--insight)', border: 'var(--insight-border)' },
  }[tone];
  const sizeStyle = size === 'sm'
    ? { fontSize: '10.5px', padding: '2px 7px', height: '18px' }
    : { fontSize: '11.5px', padding: '3px 9px', height: '22px' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      background: toneMap.bg,
      color: toneMap.color,
      border: `1px solid ${toneMap.border}`,
      borderRadius: 'var(--radius-full)',
      fontWeight: 500,
      letterSpacing: '0.01em',
      ...sizeStyle,
      ...style,
    }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />}
      {children}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS BAR
// ─────────────────────────────────────────────────────────────────────────────

const Progress = ({ value, max = 100, size = 'md', tone = 'accent', label, showValue, style }) => {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const heights = { xs: 3, sm: 4, md: 6, lg: 8 };
  const fillColor = {
    accent: 'var(--accent)',
    success: 'var(--success)',
    neutral: 'var(--text-secondary)',
  }[tone];
  return (
    <div style={{ width: '100%', ...style }}>
      {(label || showValue) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
          {label && <span>{label}</span>}
          {showValue && <span>{Math.round(pct)}%</span>}
        </div>
      )}
      <div style={{
        height: heights[size],
        background: 'var(--bg-active)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: fillColor,
          borderRadius: 'var(--radius-full)',
          transition: 'width var(--t-slow)',
        }} />
      </div>
    </div>
  );
};

// Segmented progress — for in-lesson progress (sections done/total)
const SegmentedProgress = ({ total, done, current, style }) => (
  <div style={{ display: 'flex', gap: 3, ...style }}>
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} style={{
        flex: 1,
        height: 3,
        borderRadius: 999,
        background: i < done ? 'var(--accent)' : i === current ? 'var(--accent-subtle)' : 'var(--bg-active)',
        transition: 'background var(--t-base)',
      }} />
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// INPUT
// ─────────────────────────────────────────────────────────────────────────────

const Input = ({ leftIcon, rightSlot, size = 'md', style, ...props }) => {
  const heights = { sm: 28, md: 34, lg: 40 };
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: heights[size],
      padding: '0 10px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
      ...(focus ? { borderColor: 'var(--accent)', boxShadow: 'var(--shadow-focus)' } : {}),
      ...style,
    }}>
      {leftIcon && <Icon name={leftIcon} size={14} style={{ color: 'var(--text-tertiary)' }} />}
      <input
        style={{
          flex: 1,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontFamily: 'inherit',
          fontSize: size === 'sm' ? 'var(--fs-xs)' : 'var(--fs-sm)',
          color: 'var(--text)',
          minWidth: 0,
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        {...props}
      />
      {rightSlot}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CARD
// ─────────────────────────────────────────────────────────────────────────────

const Card = ({ children, hoverable, padded = true, style, ...props }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: padded ? 'var(--space-5)' : 0,
        transition: 'border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast)',
        ...(hoverable && hover ? {
          borderColor: 'var(--border-strong)',
          boxShadow: 'var(--shadow-md)',
          cursor: 'pointer',
        } : {}),
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WIDGET CONTAINER — the heart of the lesson view
// ─────────────────────────────────────────────────────────────────────────────

const widgetMeta = {
  theory:  { color: 'var(--widget-theory)',  label: 'Theory',           icon: 'fileText' },
  demo:    { color: 'var(--widget-demo)',    label: 'Interactive Demo', icon: 'flask' },
  quiz:    { color: 'var(--widget-quiz)',    label: 'Quiz',             icon: 'target' },
  code:    { color: 'var(--widget-code)',    label: 'Code Exercise',    icon: 'code' },
  sandbox: { color: 'var(--widget-sandbox)', label: 'Sandbox',          icon: 'terminal' },
  custom:  { color: 'var(--accent)',         label: 'Custom Widget',    icon: 'layers' },
};

const Widget = ({ type = 'theory', title, status, sectionNumber, children, footer, style, headerRight }) => {
  const meta = widgetMeta[type];
  return (
    <section style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      position: 'relative',
      ...style,
    }}>
      {/* Hairline accent rail on the left */}
      <div style={{
        position: 'absolute',
        left: 0, top: 0, bottom: 0,
        width: 2,
        background: meta.color,
        opacity: 0.7,
      }} />
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}>
        <div style={{
          color: meta.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28, height: 28,
          borderRadius: 'var(--radius-sm)',
          background: 'color-mix(in srgb, currentColor 8%, transparent)',
        }}>
          <Icon name={meta.icon} size={14} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '10.5px',
            color: meta.color,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            opacity: 0.85,
          }}>
            {sectionNumber && <span style={{ color: 'var(--text-quaternary)', marginRight: 6 }}>§ {sectionNumber}</span>}
            {meta.label}
          </div>
          {title && <h3 style={{
            margin: '2px 0 0',
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{title}</h3>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {headerRight}
          {status === 'done' && <Badge tone="success" size="sm" dot>Completed</Badge>}
          {status === 'progress' && <Badge tone="accent" size="sm" dot>In progress</Badge>}
        </div>
      </header>
      <div>{children}</div>
      {footer}
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CALLOUT — for theory widget
// ─────────────────────────────────────────────────────────────────────────────

const Callout = ({ tone = 'info', title, children, style }) => {
  const toneMap = {
    info:    { bg: 'var(--accent-subtle)',  border: 'var(--accent-border)',  color: 'var(--accent-text)',  icon: 'info' },
    warning: { bg: 'var(--warning-subtle)', border: 'var(--warning-border)', color: 'var(--warning)',      icon: 'alertTriangle' },
    insight: { bg: 'var(--insight-subtle)', border: 'var(--insight-border)', color: 'var(--insight)',      icon: 'lightbulb' },
  }[tone];
  return (
    <aside style={{
      background: toneMap.bg,
      border: `1px solid ${toneMap.border}`,
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
      display: 'flex',
      gap: 'var(--space-3)',
      ...style,
    }}>
      <div style={{ color: toneMap.color, flexShrink: 0, marginTop: 2 }}>
        <Icon name={toneMap.icon} size={16} />
      </div>
      <div style={{ flex: 1 }}>
        {title && <div style={{ fontWeight: 600, color: toneMap.color, marginBottom: 4, fontSize: 'var(--fs-sm)' }}>{title}</div>}
        <div style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)', lineHeight: 1.65 }}>{children}</div>
      </div>
    </aside>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CODE BLOCK — syntax-highlighted, hand-tokenized for the demo
// ─────────────────────────────────────────────────────────────────────────────

const CodeBlock = ({ code, language = 'python', showLineNumbers = true, style }) => {
  const lines = code.split('\n');
  return (
    <pre style={{
      margin: 0,
      background: 'var(--code-bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) 0',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      lineHeight: 1.6,
      overflow: 'auto',
      color: 'var(--code-text)',
      ...style,
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', padding: '0 var(--space-4)' }}>
          {showLineNumbers && (
            <span style={{
              color: 'var(--text-quaternary)',
              marginRight: 16,
              userSelect: 'none',
              minWidth: 18,
              textAlign: 'right',
              fontSize: '12px',
            }}>{i + 1}</span>
          )}
          <span style={{ flex: 1 }} dangerouslySetInnerHTML={{ __html: highlightPython(line) }} />
        </div>
      ))}
    </pre>
  );
};

function highlightPython(line) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = escape(line);
  // strings
  html = html.replace(/(["'])(.*?)\1/g, '<span style="color:var(--code-string)">$&</span>');
  // comments
  html = html.replace(/(#.*$)/g, '<span style="color:var(--code-comment);font-style:italic">$1</span>');
  // keywords
  html = html.replace(/\b(def|return|import|from|as|if|else|elif|for|while|in|class|with|try|except|None|True|False|and|or|not|lambda|yield|self|pass|break|continue)\b/g,
    '<span style="color:var(--code-keyword);font-weight:500">$1</span>');
  // numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:var(--code-number)">$1</span>');
  // function calls
  html = html.replace(/(\w+)(\()/g, '<span style="color:var(--code-fn)">$1</span>$2');
  return html || '&nbsp;';
}

// Export everything to window so other Babel scripts can use
Object.assign(window, {
  Icon, Button, Kbd, Badge, Progress, SegmentedProgress, Input, Card,
  Widget, Callout, CodeBlock, widgetMeta,
});
