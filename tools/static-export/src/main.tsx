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
import './zajawa-theme.css'; // reskin do stylu zajawa.eu (po static.css → nadpisuje)

import { readPayload } from './payload';
import { StaticLesson } from './StaticLesson';
import { CourseIndex } from './CourseIndex';
import { Home } from './Home';

function applyTheme() {
  // Reskin zajawa.eu jest light-only — wymuszamy jasny motyw niezależnie od OS.
  document.documentElement.setAttribute('data-theme', 'light');
}

// Rewrite every `/api/courses/<slug>/assets/X` reference inside the payload
// to a real relative URL (`courseAssetBase + X`). The apiShim only catches
// fetch() calls — but <img src=…>, <audio src=…>, <video src=…> are loaded
// directly by the browser and would 404 on a static host. Doing it here, on
// the whole payload, fixes theory markdown image links, PlotImage src, and
// any other asset URL in one place.
function rewriteAssetUrls(payload: ReturnType<typeof readPayload>) {
  const oldPrefix = `/api/courses/${payload.courseSlug}/assets/`;
  const newPrefix = payload.courseAssetBase;
  const json = JSON.stringify(payload);
  if (!json.includes(oldPrefix)) return payload;
  return JSON.parse(json.split(oldPrefix).join(newPrefix));
}

function boot() {
  applyTheme();
  installApiShim();

  const payload = rewriteAssetUrls(readPayload());
  document.title =
    payload.kind === 'home'
      ? (payload.library?.title ?? 'AI Lecturer library')
      : payload.kind === 'lesson' && payload.lesson?.title
        ? `${payload.lesson.title} · ${payload.course?.title ?? ''}`
        : (payload.course?.title ?? 'AI Lecturer course');

  const mount = document.getElementById('root');
  if (!mount) throw new Error('[static-export] #root not found');

  createRoot(mount).render(
    <StrictMode>
      {payload.kind === 'home' ? (
        <Home payload={payload} />
      ) : payload.kind === 'lesson' ? (
        <StaticLesson payload={payload} />
      ) : (
        <CourseIndex payload={payload} />
      )}
    </StrictMode>,
  );
}

boot();
