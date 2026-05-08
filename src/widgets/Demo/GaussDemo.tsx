'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { RotateCcw } from 'lucide-react';

import { ZoomableImage } from '@/components/ZoomableImage';
import { usePyodide } from '@/lib/pyodide/client';

import type { DemoData } from './schema';

export interface GaussDemoProps {
  data: DemoData;
}

const IMAGE_AREA_HEIGHT = 260;
const DEBOUNCE_MS = 60;

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const imageAreaStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: IMAGE_AREA_HEIGHT,
  background: 'var(--bg-subtle)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const imageBaseStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  display: 'block',
};

const controlsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
};

const sliderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const sliderLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--text)',
  minWidth: 14,
};

const sliderValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  minWidth: 44,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const resetRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const resetButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 var(--space-3)',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid transparent',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 120ms, color 120ms',
};

const footerStyle: CSSProperties = {
  background: 'var(--bg-subtle)',
  borderTop: '1px solid var(--border)',
  padding: 'var(--space-3) var(--space-5)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  fontStyle: 'italic',
};

const SLIDER_CSS = `
.gaussdemo-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 14px;
  background: transparent;
  outline: none;
  cursor: pointer;
}
.gaussdemo-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--gauss-fill, 0%),
    var(--bg-subtle) var(--gauss-fill, 0%),
    var(--bg-subtle) 100%
  );
  border: 1px solid var(--border);
}
.gaussdemo-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
}
.gaussdemo-slider::-moz-range-progress {
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}
.gaussdemo-slider::-webkit-slider-thumb {
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
  transition: transform 120ms;
}
.gaussdemo-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.08); }
.gaussdemo-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  box-shadow: var(--shadow-sm);
  cursor: grab;
}
.gaussdemo-reset:hover {
  background: var(--bg-hover);
  color: var(--text);
}
`;

function describeSigma(sigma: number): string {
  if (sigma < 1) {
    return 'Filter is doing little — kernel is too narrow to suppress noise.';
  }
  if (sigma < 3) {
    return 'Mild smoothing — high-frequency noise reduced, edges preserved.';
  }
  if (sigma < 6) {
    return 'Moderate blur — fine texture is gone, large structures remain.';
  }
  return 'Heavy blur — fine details lost, image looks dreamy.';
}

interface SourceImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

async function loadImageRGBA(src: string): Promise<SourceImage> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    pixels: imgData.data,
    width: canvas.width,
    height: canvas.height,
  };
}

export function GaussDemo({ data }: GaussDemoProps) {
  const { status, gaussFilter } = usePyodide();
  const { imageSrc, params } = data;
  const { sigmaMin, sigmaMax, sigmaDefault } = params;

  const [sigma, setSigma] = useState<number>(sigmaDefault);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<SourceImage | null>(null);
  // Monotonic request id so out-of-order worker responses are dropped.
  const latestReqRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const pendingSigmaRef = useRef<number | null>(null);

  const fillPct = useMemo(() => {
    const t = (sigma - sigmaMin) / Math.max(sigmaMax - sigmaMin, 1e-6);
    return `${Math.max(0, Math.min(1, t)) * 100}%`;
  }, [sigma, sigmaMin, sigmaMax]);

  const runFilter = useCallback(
    async (sigmaValue: number) => {
      const src = sourceRef.current;
      if (!src) return;
      if (status !== 'ready') return;
      const reqId = ++latestReqRef.current;
      // Workers consume the buffer (transferable), so always send a fresh copy.
      const copy = new Uint8Array(src.pixels.buffer.slice(0));
      try {
        const result = await gaussFilter(copy, src.width, src.height, sigmaValue);
        if (reqId !== latestReqRef.current) return; // stale
        if (!(result.png instanceof Uint8Array)) return;
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);
        if (reqId !== latestReqRef.current) {
          bitmap.close();
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        setOverlayVisible(true);
      } catch {
        // Filter failures are non-fatal — original image stays visible.
      }
    },
    [gaussFilter, status],
  );

  // Load source image once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const img = await loadImageRGBA(imageSrc);
        if (cancelled) return;
        sourceRef.current = img;
        // Kick off an initial filter at sigmaDefault so the overlay matches the
        // slider value as soon as Pyodide is ready.
        if (status === 'ready') {
          void runFilter(sigmaDefault);
        } else {
          pendingSigmaRef.current = sigmaDefault;
        }
      } catch {
        // If the image can't load, the original stays missing — no overlay either.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  // When Pyodide flips to ready, run any deferred initial filter.
  useEffect(() => {
    if (status !== 'ready') return;
    if (pendingSigmaRef.current !== null && sourceRef.current) {
      const s = pendingSigmaRef.current;
      pendingSigmaRef.current = null;
      void runFilter(s);
    }
  }, [status, runFilter]);

  const handleSliderInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      setSigma(value);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void runFilter(value);
      }, DEBOUNCE_MS);
    },
    [runFilter],
  );

  const handleReset = useCallback(() => {
    setSigma(sigmaDefault);
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void runFilter(sigmaDefault);
  }, [runFilter, sigmaDefault]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div data-gaussdemo style={wrapStyle}>
      <style>{SLIDER_CSS}</style>
      <div data-gaussdemo-image style={imageAreaStyle}>
        <ZoomableImage
          src={imageSrc}
          alt="Gaussian filter demo source"
          style={imageBaseStyle}
          imgProps={{ 'data-gaussdemo-original': '' }}
        />
        <canvas
          ref={canvasRef}
          data-gaussdemo-overlay
          style={{
            ...imageBaseStyle,
            opacity: overlayVisible ? 1 : 0,
            transition: 'opacity 120ms',
          }}
          aria-hidden
        />
      </div>
      <div style={controlsStyle}>
        <div style={sliderRowStyle}>
          <span style={sliderLabelStyle}>σ</span>
          <span style={sliderValueStyle} data-gaussdemo-value>
            {sigma.toFixed(1)}
          </span>
          <input
            type="range"
            className="gaussdemo-slider"
            data-gaussdemo-slider
            min={sigmaMin}
            max={sigmaMax}
            step={0.1}
            value={sigma}
            onChange={handleSliderInput}
            aria-label="Gaussian sigma"
            style={{ ['--gauss-fill' as string]: fillPct } as CSSProperties}
          />
        </div>
        <div style={resetRowStyle}>
          <button
            type="button"
            className="gaussdemo-reset"
            data-gaussdemo-reset
            onClick={handleReset}
            style={resetButtonStyle}
            aria-label="Reset sigma to default"
          >
            <RotateCcw size={12} aria-hidden />
            Reset
          </button>
        </div>
      </div>
      <div data-gaussdemo-footer style={footerStyle}>
        {describeSigma(sigma)}
      </div>
    </div>
  );
}
