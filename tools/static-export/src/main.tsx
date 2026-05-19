// Runtime entry for every exported page. The exporter injects window.__SX__
// (course/lesson data + relative paths) before this bundle loads.

import { installApiShim } from './apiShim'; // side-effect: patch fetch FIRST
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Design tokens come straight from the main app (pure CSS variables, no
// Tailwind) so widgets — which style themselves with var(--…) inline —
// look identical to the real app. KaTeX is needed by theory math.
import '@/styles/tokens.css';
import 'katex/dist/katex.min.css';
import './static.css';

import { readPayload } from './payload';
import { StaticLesson } from './StaticLesson';
import { CourseIndex } from './CourseIndex';

function applyTheme() {
  try {
    const dark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute(
      'data-theme',
      dark ? 'dark' : 'light',
    );
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

function boot() {
  applyTheme();
  installApiShim();

  const payload = readPayload();
  document.title =
    payload.kind === 'lesson' && payload.lesson?.title
      ? `${payload.lesson.title} · ${payload.course?.title ?? ''}`
      : (payload.course?.title ?? 'AI Lecturer course');

  const mount = document.getElementById('root');
  if (!mount) throw new Error('[static-export] #root not found');

  createRoot(mount).render(
    <StrictMode>
      {payload.kind === 'lesson' ? (
        <StaticLesson payload={payload} />
      ) : (
        <CourseIndex payload={payload} />
      )}
    </StrictMode>,
  );
}

boot();
