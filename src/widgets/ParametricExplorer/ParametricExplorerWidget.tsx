'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { usePyodide } from '@/lib/pyodide/client';

import { formatValueOutput } from './formatValue';
import type { ParametricExplorerData, ParametricExplorerParam } from './schema';

export interface ParametricExplorerWidgetProps {
  data: ParametricExplorerData;
}

const DEFAULT_DEBOUNCE_MS = 150;

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const outputAreaStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 240,
  background: 'var(--bg-subtle)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-4)',
};

const plotImgStyle: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  objectFit: 'contain',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
};

const plotPlaceholderStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-tertiary)',
};

const valueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text)',
  textAlign: 'center',
  wordBreak: 'break-word',
  padding: 'var(--space-3) 0',
};

const stackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-3)',
  width: '100%',
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
};

const paramRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const paramLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--text)',
  minWidth: 110,
};

const paramValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  minWidth: 56,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const errorStyle: CSSProperties = {
  background: 'var(--danger-subtle)',
  color: 'var(--danger)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const errorHeadlineStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const errorToggleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const errorTracebackStyle: CSSProperties = {
  margin: 0,
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  opacity: 0.85,
};

const SLIDER_CSS = `
.pexp-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 14px;
  background: transparent;
  outline: none;
  cursor: pointer;
}
.pexp-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.pexp-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.pexp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  box-shadow: var(--shadow-sm);
  margin-top: -6px;
  cursor: grab;
}
.pexp-slider::-webkit-slider-thumb:active { cursor: grabbing; }
.pexp-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  box-shadow: var(--shadow-sm);
  cursor: grab;
}
`;

type ParamValue = number | string | boolean;

function initialParamValues(
  params: ParametricExplorerParam[],
): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of params) out[p.name] = p.default;
  return out;
}

function formatParamValue(p: ParametricExplorerParam, v: ParamValue): string {
  if (p.type === 'slider' && typeof v === 'number') {
    const step = p.step ?? 1;
    const decimals =
      step >= 1 ? 0 : Math.min(4, Math.max(0, -Math.floor(Math.log10(step))));
    return v.toFixed(decimals);
  }
  if (p.type === 'toggle') return v ? 'on' : 'off';
  return String(v);
}

export function ParametricExplorerWidget({ data }: ParametricExplorerWidgetProps) {
  const { status, runWithPlotParam } = usePyodide();
  const { setupCode, renderCode, params, outputType } = data;
  const debounceMs = data.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [values, setValues] = useState<Record<string, ParamValue>>(() =>
    initialParamValues(params),
  );
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [valueOut, setValueOut] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tracebackOpen, setTracebackOpen] = useState(false);

  const latestReqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const pngUrlRef = useRef<string | null>(null);

  useEffect(() => {
    pngUrlRef.current = pngUrl;
  }, [pngUrl]);

  // Revoke last object URL on unmount.
  useEffect(() => {
    return () => {
      if (pngUrlRef.current) URL.revokeObjectURL(pngUrlRef.current);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const runRender = useCallback(
    async (next: Record<string, ParamValue>) => {
      if (status !== 'ready') return;
      const reqId = ++latestReqRef.current;
      try {
        const result = await runWithPlotParam({
          setupCode,
          renderCode,
          params: next,
          outputType,
        });
        if (reqId !== latestReqRef.current) return;
        if (result.traceback) {
          setErrorMsg(result.traceback);
          setErrorType(result.errorType ?? null);
          setErrorMessage(result.errorMessage ?? null);
          setTracebackOpen(false);
          return;
        }
        setErrorMsg(null);
        setErrorType(null);
        setErrorMessage(null);
        if (result.png && result.png instanceof Uint8Array) {
          const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          setPngUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        } else if (outputType === 'plot' || outputType === 'both') {
          setPngUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
        if (outputType !== 'plot') {
          setValueOut(result.value ?? null);
        }
      } catch (err) {
        if (reqId !== latestReqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        setErrorType(err instanceof Error ? err.name : null);
        setErrorMessage(msg);
        setTracebackOpen(false);
      }
    },
    [outputType, renderCode, runWithPlotParam, setupCode, status],
  );

  const initialRenderRef = useRef(false);

  // Initial render once Pyodide is ready. The ref guard suppresses double-fires
  // and lets the lint rule see this effect as a one-shot subscription.
  useEffect(() => {
    if (status !== 'ready') return;
    if (initialRenderRef.current) return;
    initialRenderRef.current = true;
    void runRender(initialParamValues(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleParamChange = useCallback(
    (name: string, raw: ParamValue) => {
      setValues((prev) => {
        const next = { ...prev, [name]: raw };
        if (debounceRef.current !== null) {
          window.clearTimeout(debounceRef.current);
        }
        debounceRef.current = window.setTimeout(() => {
          debounceRef.current = null;
          void runRender(next);
        }, debounceMs);
        return next;
      });
    },
    [debounceMs, runRender],
  );

  const showPlot = outputType === 'plot' || outputType === 'both';
  const showValue = outputType === 'value' || outputType === 'both';

  const valueText = useMemo(() => formatValueOutput(valueOut), [valueOut]);

  return (
    <div data-pexp style={wrapStyle}>
      <style>{SLIDER_CSS}</style>
      <div data-pexp-output style={outputAreaStyle}>
        <div style={stackStyle}>
          {showPlot &&
            (pngUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="pexp-plot"
                src={pngUrl}
                alt="Parametric explorer plot"
                style={plotImgStyle}
              />
            ) : (
              <div style={plotPlaceholderStyle} data-testid="pexp-plot-placeholder">
                {status === 'ready' ? 'Rendering…' : 'Loading Python runtime…'}
              </div>
            ))}
          {showValue && (
            <div
              style={valueStyle}
              data-testid="parametric-value-output"
              data-pexp-value={valueText ?? ''}
            >
              {valueText ?? '—'}
            </div>
          )}
        </div>
      </div>
      {errorMsg && (
        <div data-testid="pexp-error" style={errorStyle}>
          <p
            data-testid="pexp-error-headline"
            data-error-type={errorType ?? ''}
            style={errorHeadlineStyle}
          >
            {(errorType ?? 'Error') + (errorMessage ? `: ${errorMessage}` : '')}
          </p>
          <button
            type="button"
            data-testid="pexp-traceback-toggle"
            aria-expanded={tracebackOpen}
            onClick={() => setTracebackOpen((v) => !v)}
            style={errorToggleStyle}
          >
            {tracebackOpen ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            {tracebackOpen ? 'Hide traceback' : 'Show traceback'}
          </button>
          {tracebackOpen && (
            <pre data-testid="pexp-traceback" style={errorTracebackStyle}>
              {errorMsg}
            </pre>
          )}
        </div>
      )}
      <div style={controlsStyle}>
        {params.map((p) => (
          <ParamControl
            key={p.name}
            param={p}
            value={values[p.name]}
            onChange={handleParamChange}
          />
        ))}
      </div>
    </div>
  );
}

interface ParamControlProps {
  param: ParametricExplorerParam;
  value: ParamValue;
  onChange: (name: string, value: ParamValue) => void;
}

function ParamControl({ param, value, onChange }: ParamControlProps) {
  if (param.type === 'slider') {
    const numericValue =
      typeof value === 'number' ? value : Number(param.default ?? 0);
    return (
      <div style={paramRowStyle}>
        <span style={paramLabelStyle}>{param.label}</span>
        <span style={paramValueStyle} data-testid={`pexp-value-${param.name}`}>
          {formatParamValue(param, numericValue)}
        </span>
        <input
          type="range"
          className="pexp-slider"
          data-testid={`pexp-slider-${param.name}`}
          min={param.min ?? 0}
          max={param.max ?? 100}
          step={param.step ?? 1}
          value={numericValue}
          onChange={(e) => onChange(param.name, Number(e.target.value))}
          aria-label={param.label}
        />
      </div>
    );
  }
  if (param.type === 'select') {
    const stringValue = typeof value === 'string' ? value : String(value);
    return (
      <div style={paramRowStyle}>
        <span style={paramLabelStyle}>{param.label}</span>
        <select
          data-testid={`pexp-select-${param.name}`}
          value={stringValue}
          onChange={(e) => onChange(param.name, e.target.value)}
          aria-label={param.label}
          style={{
            flex: 1,
            padding: '4px 8px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {(param.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }
  // toggle
  const boolValue = Boolean(value);
  return (
    <div style={paramRowStyle}>
      <span style={paramLabelStyle}>{param.label}</span>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          data-testid={`pexp-toggle-${param.name}`}
          checked={boolValue}
          onChange={(e) => onChange(param.name, e.target.checked)}
          aria-label={param.label}
        />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          {boolValue ? 'on' : 'off'}
        </span>
      </label>
    </div>
  );
}
