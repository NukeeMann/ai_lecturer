'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

const COLORS = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#eab308',
];
const PARTICLE_COUNT = 28;
const DURATION_MS = 1700;

type Shape = 'circle' | 'rect' | 'square';

interface Particle {
  id: number;
  color: string;
  dx: number;
  dy: number;
  rotateEnd: number;
  size: number;
  shape: Shape;
  delay: number;
}

function generateParticles(): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const radius = 140 + Math.random() * 180;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius - 40;
    const shapes: Shape[] = ['circle', 'rect', 'square'];
    particles.push({
      id: i,
      color: COLORS[i % COLORS.length],
      dx,
      dy,
      rotateEnd: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 8,
      shape: shapes[i % shapes.length],
      delay: Math.random() * 80,
    });
  }
  return particles;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ConfettiProps {
  /**
   * When this value changes (and is truthy), a burst plays. Pass `0` / `null`
   * for the initial render to suppress firing on mount.
   */
  trigger: number | string | null;
  /** Optional element to anchor the burst origin (defaults to viewport centre). */
  originRef?: React.RefObject<HTMLElement | null>;
}

interface BurstState {
  key: number;
  particles: Particle[];
  origin: { x: number; y: number };
}

export function Confetti({ trigger, originRef }: ConfettiProps) {
  const [bursts, setBursts] = useState<BurstState[]>([]);
  const lastTrigger = useRef(trigger);
  const burstSeq = useRef(0);

  useEffect(() => {
    if (lastTrigger.current === trigger) return;
    lastTrigger.current = trigger;
    if (!trigger) return;
    if (prefersReducedMotion()) return;

    let origin = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const el = originRef?.current ?? null;
    if (el) {
      const rect = el.getBoundingClientRect();
      origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    burstSeq.current += 1;
    const burst: BurstState = {
      key: burstSeq.current,
      particles: generateParticles(),
      origin,
    };
    setBursts((prev) => [...prev, burst]);

    const timeoutId = window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.key !== burst.key));
    }, DURATION_MS + 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [trigger, originRef]);

  if (bursts.length === 0) return null;

  return (
    <div
      data-confetti-overlay
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 9999,
      }}
    >
      {bursts.map((burst) =>
        burst.particles.map((p) => {
          const style: CSSProperties & Record<string, string | number> = {
            position: 'absolute',
            left: burst.origin.x,
            top: burst.origin.y,
            width: p.size,
            height: p.shape === 'rect' ? p.size * 0.4 : p.size,
            backgroundColor: p.color,
            borderRadius:
              p.shape === 'circle' ? '50%' : p.shape === 'rect' ? 1 : 2,
            animation: `ai-confetti-burst ${DURATION_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards`,
            animationDelay: `${p.delay}ms`,
            willChange: 'transform, opacity',
            '--cx': `${p.dx}px`,
            '--cy': `${p.dy}px`,
            '--rot': `${p.rotateEnd}deg`,
          };
          return (
            <span
              key={`${burst.key}-${p.id}`}
              data-confetti-particle
              style={style}
            />
          );
        }),
      )}
    </div>
  );
}
