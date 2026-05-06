'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import Stage3Cascade, {
  type Draft,
  type Level,
  type DurationTarget,
  type StructureDraft,
} from './Stage3Cascade';
import Stage3Clarify from './Stage3Clarify';
import {
  computeStageInputHash,
  isStageStale,
  snapshotUpstreamHashes,
  staleStages,
} from '@/lib/wizard/dependencies';
import {
  visibleLessonSlots,
  computeSliderEdges,
} from '@/lib/lessons/lessonSlots';
import { reverseLogLines, reverseLiveLogLines } from '@/lib/lessons/genLog';

const DEFAULT_DRAFT: Draft = {
  topic: '',
  level: null,
  durationTarget: null,
  theoryPracticeRatio: 50,
  clarificationQuestions: undefined,
  clarification: undefined,
  structure: null,
};

// US-103 — Stages 'choose' and 'materials' are pre-flow steps. The
// existing 6-step wizard kicks in once the user reaches stage 1.
type WizardStage = 'choose' | 'materials' | 1 | 2 | 3 | 4 | 5 | 6;

type EntryPath = 'scratch' | 'materials';

interface UploadedMaterial {
  originalName: string;
  sanitizedName: string;
  size: number;
  type: string;
}

// US-106 / US-107 — shape of GET /api/courses/active-run. Queue context was
// added in US-107 so the resume banner can show "X w kolejce" alongside the
// active run.
interface QueueEntry {
  slug: string;
  name: string;
  position: number;
}

type ActiveRunResponse =
  | { active: false; queue: QueueEntry[] }
  | { active: true; slug: string; name: string; stage: string; queue: QueueEntry[] };

interface ActiveRun {
  slug: string;
  name: string;
  stage: string;
  queueLength: number;
}

// Surfaced both to the route and the UI so they stay in sync.
const MATERIAL_ALLOWED_EXTS = ['.pdf', '.pptx', '.docx', '.txt', '.json'] as const;
const MATERIAL_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MiB. Mirrors src/lib/server/sources.ts MAX_FILE_SIZE_BYTES.
const MATERIAL_ACCEPT_ATTR = MATERIAL_ALLOWED_EXTS.join(',');

function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

const STAGES = [
  { id: 1, label: 'Topic' },
  { id: 2, label: 'Refine' },
  { id: 3, label: 'Clarify' },
  { id: 4, label: 'Structure' },
  { id: 5, label: 'Approve' },
  { id: 6, label: 'Generate' },
] as const;

const PLACEHOLDER_TOPICS = [
  'How neural networks learn from data',
  'Bayesian inference for engineers',
  'Linear algebra for machine learning',
  'How transformers work, end to end',
];

const SUGGESTION_TOPICS = [
  'Backpropagation',
  'Linear algebra for ML',
  'How GPT works',
  'Bayesian statistics',
];

const LEVEL_OPTIONS: { value: Level; label: string; description: string }[] = [
  { value: 'beginner', label: 'Beginner', description: 'Brand new to this topic' },
  { value: 'intermediate', label: 'Some experience', description: 'I dabbled but not deeply' },
  { value: 'advanced', label: 'I know the basics', description: 'Comfortable with the surface' },
];

const DURATION_OPTIONS: { value: DurationTarget; label: string }[] = [
  { value: 'short', label: 'Short (3–5 lessons)' },
  { value: 'standard', label: 'Standard (8–12)' },
  { value: 'extensive', label: 'Extensive (20–30)' },
  { value: 'comprehensive', label: 'Comprehensive (40+)' },
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function ratioLabel(ratio: number): string {
  if (ratio < 34) return 'Mostly theory';
  if (ratio > 66) return 'Mostly practice';
  return 'Balanced';
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CreatePage() {
  const router = useRouter();
  const [stage, setStage] = useState<WizardStage>('choose');
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedSlug, setSubmittedSlug] = useState<string | null>(null);
  // US-103 — entry-path state. `entryPath === 'materials'` triggers the
  // pre-flow file-picker step; the staged uploads are bound to a server-
  // side draftId until POST /api/courses promotes them to the slug.
  const [entryPath, setEntryPath] = useState<EntryPath | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<UploadedMaterial[]>([]);
  // US-106 — resume-banner state. Populated from GET /api/courses/active-run
  // on mount; cleared when the user dismisses or resumes.
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('idea') ?? params.get('topic');
    if (t && t.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({ ...d, topic: t }));
    }
    // US-106 — `?resume=<slug>` opens directly into the Stage 6 generation
    // panel for that slug. Stage5Generate's effect calls POST /generate which
    // is idempotent for the same slug (US-105) and reattaches to the live
    // SSE stream + persisted logs.
    const resume = params.get('resume');
    if (resume && resume.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubmittedSlug(resume);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStage(6);
    }
  }, []);

  // US-106 — probe the server for an in-flight run on mount. Banner shows
  // unless the user explicitly dismissed it OR they're already inside Stage 6
  // (resume target — banner would be redundant).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/courses/active-run', { cache: 'no-store' });
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as ActiveRunResponse;
        if (cancelled) return;
        if (body && body.active === true) {
          const ql = Array.isArray(body.queue) ? body.queue.length : 0;
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setActiveRun({ slug: body.slug, name: body.name, stage: body.stage, queueLength: ql });
        } else {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setActiveRun(null);
        }
      } catch {
        /* best-effort — banner is a UX nicety */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToDashboard = () => {
    if (draft.topic.trim().length > 0 || materials.length > 0) {
      const ok = window.confirm('Discard this draft and return to the dashboard?');
      if (!ok) return;
    }
    router.push('/');
  };

  const handleStepperJump = (id: number) => {
    if (typeof stage === 'number' && id < stage) setStage(id as WizardStage);
  };

  const handleRemoveMaterial = useCallback(
    async (sanitizedName: string) => {
      if (!draftId) return;
      // Optimistic local removal; the server delete is best-effort.
      setMaterials((prev) => prev.filter((m) => m.sanitizedName !== sanitizedName));
      try {
        await fetch(
          `/api/courses/upload-sources?draftId=${encodeURIComponent(draftId)}&filename=${encodeURIComponent(sanitizedName)}`,
          { method: 'DELETE' },
        );
      } catch {
        /* best-effort — local state already reflects removal */
      }
    },
    [draftId],
  );

  const handleGenerate = async () => {
    if (submitting) return;
    if (!draft.structure || !draft.level || !draft.durationTarget) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      let title = draft.structure.courseTitle;
      // Retry loop for 409 collisions: prompt for a new title and try again.
      while (true) {
        const spec = buildCourseSpec(draft, { ...draft.structure, courseTitle: title });
        // US-103: piggyback the staged-uploads draft id alongside the
        // spec so the server can move staged sources into /sources/.
        const payload = draftId ? { ...spec, draftId } : spec;
        const res = await fetch('/api/courses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.status === 201) {
          const body = (await res.json()) as { slug: string };
          // Persist the (possibly renamed) title back into the draft.
          if (title !== draft.structure.courseTitle) {
            setDraft((d) =>
              d.structure ? { ...d, structure: { ...d.structure, courseTitle: title } } : d,
            );
          }
          setSubmittedSlug(body.slug);
          setStage(6);
          return;
        }
        if (res.status === 409) {
          const next = window.prompt(
            `A course with that name already exists. Pick a different title:`,
            title,
          );
          if (next === null) return; // User cancelled — stay on Stage 4.
          const trimmed = next.trim();
          if (trimmed.length === 0) {
            setSubmitError('Course title cannot be empty.');
            return;
          }
          title = trimmed;
          continue;
        }
        // Any other status — surface a clear inline error and bail out.
        let message = `Server returned ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body && typeof body.error === 'string') message = body.error;
        } catch {
          /* non-JSON body */
        }
        setSubmitError(message);
        return;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelGeneration = useCallback(() => {
    setSubmittedSlug(null);
    setStage(5);
  }, []);

  const staleStageIds = useMemo(() => {
    const stale = staleStages(draft, draft.caches);
    const ids = new Set<number>();
    if (stale.has('clarification')) ids.add(3);
    if (stale.has('structure')) ids.add(4);
    if (stale.has('approval')) ids.add(5);
    return ids;
  }, [draft]);

  // The first numeric stage to land on after the entry-choice step. From
  // both 'choose' and 'materials' we go to Stage 1 (Topic).
  const goToStage = (next: WizardStage) => setStage(next);

  // Where Stage 1's back button should send the user. If they came in via
  // the materials path, "Back" returns to the picker so they can amend
  // uploads; otherwise back to the entry-choice landing.
  const stage1Back: () => void = () => setStage(entryPath === 'materials' ? 'materials' : 'choose');

  const showStepper = typeof stage === 'number';

  // US-106 — banner is shown unless the user dismissed it OR they're already
  // inside Stage 6 for the same slug (where the live panel itself is the
  // resume target — a banner pointing back to itself is noise).
  const onResumeView = stage === 6 && submittedSlug === activeRun?.slug;
  const showResumeBanner = activeRun !== null && !bannerDismissed && !onResumeView;

  return (
    <div style={pageStyle}>
      {showResumeBanner && activeRun && (
        <ResumeBanner
          activeRun={activeRun}
          onResume={() => {
            setSubmittedSlug(activeRun.slug);
            setStage(6);
          }}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}
      {showStepper && (
        <header style={headerStyle}>
          <Stepper current={stage as number} onJump={handleStepperJump} staleStageIds={staleStageIds} />
        </header>
      )}
      {showStepper && materials.length > 0 && (
        <MaterialsBanner materials={materials} onRemove={handleRemoveMaterial} />
      )}
      <main style={mainStyle}>
        {stage === 'choose' && (
          <StageChoose
            onScratch={() => {
              setEntryPath('scratch');
              goToStage(1);
            }}
            onMaterials={() => {
              setEntryPath('materials');
              goToStage('materials');
            }}
            onBack={goToDashboard}
          />
        )}
        {stage === 'materials' && (
          <StageMaterials
            draftId={draftId}
            onDraftIdAssigned={setDraftId}
            materials={materials}
            setMaterials={setMaterials}
            onRemove={handleRemoveMaterial}
            onNext={() => goToStage(1)}
            onBack={() => setStage('choose')}
          />
        )}
        {stage === 1 && (
          <Stage1
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(2)}
            onBack={stage1Back}
          />
        )}
        {stage === 2 && (
          <Stage2
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(3)}
            onBack={() => setStage(1)}
          />
        )}
        {stage === 3 && (
          <Stage3Clarify
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(4)}
            onBack={() => setStage(2)}
          />
        )}
        {stage === 4 && (
          <Stage3Cascade
            draft={draft}
            setDraft={setDraft}
            onNext={() => setStage(5)}
            onBack={() => setStage(3)}
          />
        )}
        {stage === 5 && (
          <Stage4Approval
            draft={draft}
            setDraft={setDraft}
            onBack={() => setStage(4)}
            onGenerate={handleGenerate}
            submitting={submitting}
            submitError={submitError}
          />
        )}
        {stage === 6 && submittedSlug && (
          <Stage5Generate
            slug={submittedSlug}
            onCancelled={handleCancelGeneration}
          />
        )}
      </main>
    </div>
  );
}

// Strip client-side ids and serialize draft into a CourseSpec payload.
function buildCourseSpec(draft: Draft, structure: StructureDraft) {
  const spec: Record<string, unknown> = {
    topic: draft.topic.trim(),
    level: draft.level,
    durationTarget: draft.durationTarget,
    theoryPracticeRatio: clampRatio(draft.theoryPracticeRatio / 100),
    draftStructure: {
      courseTitle: structure.courseTitle.trim(),
      courseDescription: structure.courseDescription.trim(),
      modules: structure.modules.map((m) => ({
        title: m.title.trim(),
        lessons: m.lessons.map((l) => ({
          title: l.title.trim(),
          summary: l.summary.trim(),
          estimatedMinutes: l.estimatedMinutes,
        })),
      })),
    },
    createdAt: new Date().toISOString(),
  };

  if (draft.clarificationQuestions && draft.clarificationQuestions.length > 0) {
    const answers = draft.clarification ?? {};
    const trimmed: Record<string, string> = {};
    for (const q of draft.clarificationQuestions) {
      const a = (answers[q.id] ?? '').trim();
      if (a.length > 0) trimmed[`${q.id}: ${q.text}`] = a;
    }
    if (Object.keys(trimmed).length > 0) {
      spec.clarification = trimmed;
    }
  }

  return spec;
}

function clampRatio(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({
  current,
  onJump,
  staleStageIds,
}: {
  current: number;
  onJump: (id: number) => void;
  staleStageIds?: Set<number>;
}) {
  return (
    <div data-testid="wizard-stepper" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {STAGES.map((s, i) => {
        const done = s.id < current;
        const active = s.id === current;
        const future = s.id > current;
        const canJump = done;
        const stale = staleStageIds?.has(s.id) ?? false;
        return (
          <Fragment key={s.id}>
            <button
              type="button"
              data-testid={`stepper-step-${s.id}`}
              data-step-state={done ? 'done' : active ? 'active' : 'future'}
              data-stale={stale ? 'true' : undefined}
              onClick={canJump ? () => onJump(s.id) : undefined}
              aria-current={active ? 'step' : undefined}
              disabled={future}
              title={stale ? 'Will regenerate when reopened — upstream changed' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px 4px 4px',
                background: active ? 'var(--accent-subtle)' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                cursor: canJump ? 'pointer' : 'default',
                color: active
                  ? 'var(--accent-text)'
                  : done
                    ? 'var(--text-secondary)'
                    : 'var(--text-tertiary)',
                fontSize: 'var(--fs-xs)',
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done ? 'var(--success)' : active ? 'var(--accent)' : 'transparent',
                  border: future ? '1.5px solid var(--border-strong)' : 'none',
                  color: done || active ? 'white' : 'var(--text-tertiary)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {done ? <Check size={12} strokeWidth={3} /> : s.id}
              </span>
              <span>{s.label}</span>
              {stale && (
                <span
                  data-testid={`stepper-step-${s.id}-stale`}
                  aria-label="stale"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: 'var(--warning, #d97706)',
                  }}
                >
                  <AlertTriangle size={11} strokeWidth={2.5} />
                </span>
              )}
            </button>
            {i < STAGES.length - 1 && (
              <span
                aria-hidden
                style={{
                  width: 14,
                  height: 1,
                  background: done ? 'var(--success)' : 'var(--border-strong)',
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── Stage Choose / Stage Materials (US-103) ─────────────────────────────────

function StageChoose({
  onScratch,
  onMaterials,
  onBack,
}: {
  onScratch: () => void;
  onMaterials: () => void;
  onBack: () => void;
}) {
  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage-choose"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 720 }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Start a new course
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            How would you like to begin?
          </h1>
          <p
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
              marginBottom: 'var(--space-6)',
            }}
          >
            Either tell us the topic and we&apos;ll plan it from scratch, or upload your own
            materials so the curriculum is grounded in your content.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 'var(--space-4)',
            }}
          >
            <button
              type="button"
              data-testid="entry-scratch"
              onClick={onScratch}
              style={entryCardStyle}
            >
              <span
                aria-hidden
                style={entryCardIconStyle}
              >
                <Sparkles size={20} strokeWidth={2} />
              </span>
              <span
                style={{
                  fontSize: 'var(--fs-md)',
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginTop: 14,
                }}
              >
                Start from scratch
              </span>
              <span
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                Tell us a topic and we&apos;ll research, structure, and write it for you.
              </span>
            </button>
            <button
              type="button"
              data-testid="entry-materials"
              onClick={onMaterials}
              style={entryCardStyle}
            >
              <span
                aria-hidden
                style={entryCardIconStyle}
              >
                <Upload size={20} strokeWidth={2} />
              </span>
              <span
                style={{
                  fontSize: 'var(--fs-md)',
                  fontWeight: 600,
                  color: 'var(--text)',
                  marginTop: 14,
                }}
              >
                I have materials
              </span>
              <span
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                Upload PDFs, slides, notes, or a question bank — we&apos;ll ground the course
                in your content.
              </span>
            </button>
          </div>
        </div>
      </div>
      <Footer onBack={onBack} backLabel="Cancel" hideNext />
    </div>
  );
}

function StageMaterials({
  draftId,
  onDraftIdAssigned,
  materials,
  setMaterials,
  onRemove,
  onNext,
  onBack,
}: {
  draftId: string | null;
  onDraftIdAssigned: (id: string) => void;
  materials: UploadedMaterial[];
  setMaterials: Dispatch<SetStateAction<UploadedMaterial[]>>;
  onRemove: (sanitizedName: string) => void | Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<{ name: string; reason: string }[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      // Front-end validation: extension + size. MIME is checked again on
      // the server (browsers sometimes return '' for unknown extensions).
      const localErrors: { name: string; reason: string }[] = [];
      const accepted: File[] = [];
      for (const f of list) {
        const ext = fileExtension(f.name);
        if (!MATERIAL_ALLOWED_EXTS.includes(ext as (typeof MATERIAL_ALLOWED_EXTS)[number])) {
          localErrors.push({ name: f.name, reason: `Unsupported extension "${ext || '(none)'}"` });
          continue;
        }
        if (f.size > MATERIAL_MAX_SIZE_BYTES) {
          localErrors.push({
            name: f.name,
            reason: `File too large (${formatFileSize(f.size)} > ${formatFileSize(MATERIAL_MAX_SIZE_BYTES)})`,
          });
          continue;
        }
        accepted.push(f);
      }
      if (localErrors.length > 0) setErrors((prev) => [...prev, ...localErrors]);
      if (accepted.length === 0) return;

      setUploading(true);
      setGeneralError(null);
      try {
        const fd = new FormData();
        if (draftId) fd.set('draftId', draftId);
        for (const f of accepted) fd.append('files', f);
        const res = await fetch('/api/courses/upload-sources', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok && res.status !== 400) {
          let msg = `Upload failed (${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') msg = body.error;
          } catch {
            /* non-JSON body */
          }
          setGeneralError(msg);
          return;
        }
        const body = (await res.json()) as {
          draftId?: string;
          files?: UploadedMaterial[];
          rejected?: { name: string; reason: string }[];
          error?: string;
        };
        if (res.status === 400 && body.error && (!body.files || body.files.length === 0)) {
          setGeneralError(body.error);
          return;
        }
        if (body.draftId && !draftId) onDraftIdAssigned(body.draftId);
        if (body.files && body.files.length > 0) {
          setMaterials((prev) => {
            const seen = new Set(prev.map((m) => m.sanitizedName));
            const next = [...prev];
            for (const m of body.files!) {
              if (!seen.has(m.sanitizedName)) next.push(m);
            }
            return next;
          });
        }
        if (body.rejected && body.rejected.length > 0) {
          setErrors((prev) => [...prev, ...body.rejected!]);
        }
      } catch (err) {
        setGeneralError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [draftId, onDraftIdAssigned, setMaterials],
  );

  const onPick = () => inputRef.current?.click();

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void handleFiles(e.target.files);
      // Reset so picking the same file again still fires onChange.
      e.target.value = '';
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
  };

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage-materials"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Step 1 — Upload your materials
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            What should we ground the course in?
          </h1>
          <p
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
            }}
          >
            Add lecture slides, lecture notes, exam papers, or a question bank. Accepted:{' '}
            {MATERIAL_ALLOWED_EXTS.join(' · ')}. Up to {formatFileSize(MATERIAL_MAX_SIZE_BYTES)} per file.
          </p>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={MATERIAL_ACCEPT_ATTR}
            onChange={onInputChange}
            data-testid="materials-input"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />

          <div
            data-testid="materials-dropzone"
            onClick={onPick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            style={{
              marginTop: 'var(--space-5)',
              padding: 'var(--space-6)',
              borderRadius: 'var(--radius-md)',
              border: '1.5px dashed var(--border-strong)',
              background: 'var(--bg-elevated)',
              textAlign: 'center',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            <Upload
              size={24}
              strokeWidth={1.8}
              style={{ display: 'block', margin: '0 auto', color: 'var(--text-tertiary)' }}
            />
            <div style={{ marginTop: 10, fontWeight: 500, color: 'var(--text)' }}>
              Click to choose files, or drag &amp; drop
            </div>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
              {uploading ? 'Uploading…' : `${MATERIAL_ALLOWED_EXTS.join(' · ')} · max ${formatFileSize(MATERIAL_MAX_SIZE_BYTES)}`}
            </div>
          </div>

          {generalError && (
            <div
              role="alert"
              data-testid="materials-general-error"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
                color: 'var(--danger, #b91c1c)',
                border: '1px solid var(--danger, #fca5a5)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              {generalError}
            </div>
          )}

          {errors.length > 0 && (
            <ul
              data-testid="materials-errors"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--warning-subtle, rgba(217, 119, 6, 0.08))',
                color: 'var(--warning, #b45309)',
                border: '1px solid var(--warning, #fde68a)',
                fontSize: 'var(--fs-xs)',
                listStyle: 'disc',
                paddingInlineStart: 'var(--space-5)',
                margin: 'var(--space-3) 0 0',
              }}
            >
              {errors.map((e, i) => (
                <li key={i}>
                  <strong>{e.name}</strong> — {e.reason}
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 'var(--space-5)' }}>
            <div
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                fontWeight: 600,
              }}
            >
              Uploaded ({materials.length})
            </div>
            {materials.length === 0 ? (
              <div
                data-testid="materials-empty"
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border)',
                  color: 'var(--text-tertiary)',
                  fontSize: 'var(--fs-sm)',
                }}
              >
                No files yet. You can also{' '}
                <button
                  type="button"
                  data-testid="materials-skip-link"
                  onClick={onNext}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-text)',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                    textDecoration: 'underline',
                  }}
                >
                  skip this step
                </button>
                .
              </div>
            ) : (
              <ul
                data-testid="materials-list"
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {materials.map((m) => (
                  <li
                    key={m.sanitizedName}
                    data-testid="materials-item"
                    data-filename={m.sanitizedName}
                    style={materialRowStyle}
                  >
                    <FileText size={14} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
                    <span
                      style={{
                        flex: 1,
                        fontSize: 'var(--fs-sm)',
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={m.originalName}
                    >
                      {m.sanitizedName}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        flexShrink: 0,
                      }}
                    >
                      {formatFileSize(m.size)}
                    </span>
                    <button
                      type="button"
                      data-testid="materials-remove"
                      data-filename={m.sanitizedName}
                      aria-label={`Remove ${m.sanitizedName}`}
                      onClick={() => void onRemove(m.sanitizedName)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-tertiary)',
                        cursor: 'pointer',
                        padding: 4,
                        borderRadius: 'var(--radius-sm)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Footer
        onBack={onBack}
        onNext={onNext}
        canNext
        backLabel="Back"
        nextLabel={materials.length > 0 ? 'Continue' : 'Skip'}
      />
    </div>
  );
}

// US-106 — sticky top banner shown when a generation run is detected on
// /create mount. Lets the user one-click back into the live generation panel
// (Stage 6) for the running slug, or dismiss to start a new course flow.
function ResumeBanner({
  activeRun,
  onResume,
  onDismiss,
}: {
  activeRun: ActiveRun;
  onResume: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="resume-banner"
      data-resume-slug={activeRun.slug}
      data-resume-stage={activeRun.stage}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: '10px var(--space-6)',
        background: 'var(--accent-subtle)',
        color: 'var(--accent-text)',
        borderBottom: '1px solid var(--accent)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <Sparkles size={14} strokeWidth={2} />
      <span data-testid="resume-banner-text" style={{ flex: 1 }}>
        Trwa generacja kursu{' '}
        <strong data-testid="resume-banner-name">{activeRun.name}</strong>
        {' — '}
        <span data-testid="resume-banner-stage" style={{ fontFamily: 'var(--font-mono)' }}>
          {activeRun.stage}
        </span>
        {activeRun.queueLength > 0 && (
          <>
            {' · '}
            <span data-testid="resume-banner-queue">
              {activeRun.queueLength} w kolejce
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        data-testid="resume-banner-resume"
        onClick={onResume}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 30,
          padding: '0 14px',
          background: 'var(--accent)',
          color: 'var(--text-on-accent)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        Wróć do generacji
        <ArrowRight size={12} strokeWidth={2} />
      </button>
      <button
        type="button"
        data-testid="resume-banner-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--accent-text)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 'var(--radius-sm)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

function MaterialsBanner({
  materials,
  onRemove,
}: {
  materials: UploadedMaterial[];
  onRemove: (sanitizedName: string) => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-testid="materials-banner"
      style={{
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: '8px var(--space-6)',
      }}
    >
      <button
        type="button"
        data-testid="materials-banner-toggle"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-xs)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <FileText size={12} strokeWidth={2} />
        <span>
          {materials.length} material{materials.length === 1 ? '' : 's'} attached
        </span>
        <span style={{ color: 'var(--text-tertiary)' }}>
          {expanded ? '▴ hide' : '▾ show'}
        </span>
      </button>
      {expanded && (
        <ul
          data-testid="materials-banner-list"
          style={{
            margin: '8px 0 0',
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {materials.map((m) => (
            <li
              key={m.sanitizedName}
              data-filename={m.sanitizedName}
              style={{ ...materialRowStyle, padding: '4px 8px' }}
            >
              <FileText size={12} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-tertiary)' }} />
              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={m.originalName}
              >
                {m.sanitizedName}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                  flexShrink: 0,
                }}
              >
                {formatFileSize(m.size)}
              </span>
              <button
                type="button"
                data-testid="materials-banner-remove"
                data-filename={m.sanitizedName}
                aria-label={`Remove ${m.sanitizedName}`}
                onClick={() => void onRemove(m.sanitizedName)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 2,
                  borderRadius: 'var(--radius-sm)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const entryCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  padding: 'var(--space-5)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'border-color var(--t-fast), background var(--t-fast)',
};

const entryCardIconStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent-text)',
};

const materialRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
};

// ─── Stage 1 — Topic ─────────────────────────────────────────────────────────

interface StageProps {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onNext: () => void;
  onBack: () => void;
}

function Stage1({ draft, setDraft, onNext, onBack }: StageProps) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_TOPICS.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const wc = wordCount(draft.topic);
  const canNext = wc >= 3;

  return (
    <div style={stageWrapStyle}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div
            data-testid="stage1-eyebrow"
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-tertiary)',
              marginBottom: 14,
            }}
          >
            What do you want to learn?
          </div>
          <input
            type="text"
            data-testid="stage1-topic-input"
            value={draft.topic}
            onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
            placeholder={PLACEHOLDER_TOPICS[placeholderIdx]}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canNext) {
                e.preventDefault();
                onNext();
              }
            }}
            style={{
              width: '100%',
              padding: '12px 0',
              border: 'none',
              borderBottom: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 500,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div
            style={{
              marginTop: 'var(--space-5)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {SUGGESTION_TOPICS.map((s) => (
              <button
                key={s}
                type="button"
                data-testid="stage1-suggestion-chip"
                onClick={() => setDraft((d) => ({ ...d, topic: s }))}
                style={chipStyle(false)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Footer onBack={onBack} onNext={onNext} canNext={canNext} backLabel="Back" />
    </div>
  );
}

// ─── Stage 2 — Refinement ────────────────────────────────────────────────────

function Stage2({ draft, setDraft, onNext, onBack }: StageProps) {
  const canNext = draft.level !== null && draft.durationTarget !== null;

  return (
    <div style={stageWrapStyle}>
      <div
        style={{
          flex: 1,
          padding: 'var(--space-7) var(--space-6)',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-7)',
          }}
        >
          {/* Level */}
          <section>
            <h2 style={sectionHeadingStyle}>What&apos;s your level?</h2>
            <div
              data-testid="stage2-level-group"
              role="radiogroup"
              aria-label="Your level"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-3)',
              }}
            >
              {LEVEL_OPTIONS.map((opt) => {
                const selected = draft.level === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`stage2-level-${opt.value}`}
                    data-selected={selected}
                    onClick={() => setDraft((d) => ({ ...d, level: opt.value }))}
                    style={radioCardStyle(selected)}
                  >
                    <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{opt.label}</span>
                    <span
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: selected ? 'var(--accent-text)' : 'var(--text-tertiary)',
                        marginTop: 4,
                      }}
                    >
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Duration */}
          <section>
            <h2 style={sectionHeadingStyle}>How long should this take?</h2>
            <div
              data-testid="stage2-duration-group"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              {DURATION_OPTIONS.map((opt) => {
                const selected = draft.durationTarget === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    data-testid={`stage2-duration-${opt.value}`}
                    data-selected={selected}
                    onClick={() => setDraft((d) => ({ ...d, durationTarget: opt.value }))}
                    style={chipStyle(selected)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Theory or practice slider */}
          <section>
            <h2 style={sectionHeadingStyle}>Theory or practice?</h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '8px 0',
              }}
            >
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.theoryPracticeRatio}
                data-testid="stage2-ratio-slider"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    theoryPracticeRatio: Number(e.target.value),
                  }))
                }
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                }}
              >
                <span>Theory</span>
                <span
                  data-testid="stage2-ratio-label"
                  style={{
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  {ratioLabel(draft.theoryPracticeRatio)}
                </span>
                <span>Practice</span>
              </div>
            </div>
          </section>
        </div>
      </div>
      <Footer onBack={onBack} onNext={onNext} canNext={canNext} backLabel="Back" />
    </div>
  );
}

// ─── Stage 4 — Approval ──────────────────────────────────────────────────────

function Stage4Approval({
  draft,
  setDraft,
  onBack,
  onGenerate,
  submitting,
  submitError,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onBack: () => void;
  onGenerate: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  // Approval has no Claude call — "regeneration" is just refreshing the
  // recorded upstream-hash snapshot so the stale indicator clears once the
  // user has actually viewed the new summary. (No confirm dialog: user can't
  // edit Approval, so there's nothing to lose.)
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (refreshedRef.current) return;
    refreshedRef.current = true;
    const cache = draft.caches?.approval;
    const stale = isStageStale('approval', draft, cache);
    if (!cache || stale) {
      setDraft((d) => {
        const generatedHash = computeStageInputHash('structure', d);
        return {
          ...d,
          caches: {
            ...(d.caches ?? {}),
            approval: {
              upstreamHashes: snapshotUpstreamHashes('approval', d),
              generatedHash,
            },
          },
        };
      });
    }
  }, [draft, setDraft]);

  const s = draft.structure;
  const lessonCount = s ? s.modules.reduce((sum, m) => sum + m.lessons.length, 0) : 0;
  const totalMinutes = s
    ? s.modules.reduce(
        (sum, m) => sum + m.lessons.reduce((ms, l) => ms + l.estimatedMinutes, 0),
        0,
      )
    : 0;
  const generationMinutes = lessonCount * 3;

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage4-approval"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Stage 5 of 6 · Final review
          </div>
          {s ? (
            <>
              <h1
                data-testid="stage4-course-title"
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-2xl)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                }}
              >
                {s.courseTitle}
              </h1>
              <p
                data-testid="stage4-course-description"
                style={{
                  marginTop: 6,
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-sm)',
                  lineHeight: 1.55,
                }}
              >
                {s.courseDescription}
              </p>
              <div
                data-testid="stage4-totals"
                style={{
                  marginTop: 'var(--space-3)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {s.modules.length} modules · {lessonCount} lessons · ~{totalMinutes} min total
              </div>
              <div
                style={{
                  marginTop: 'var(--space-5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                }}
              >
                {s.modules.map((m, idx) => {
                  const moduleMinutes = m.lessons.reduce((ms, l) => ms + l.estimatedMinutes, 0);
                  return (
                    <div
                      key={m.id}
                      data-testid={`stage4-module-${m.id}`}
                      style={{
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-4)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          gap: 'var(--space-3)',
                        }}
                      >
                        <div
                          data-testid={`stage4-module-title-${m.id}`}
                          style={{
                            fontSize: 'var(--fs-md)',
                            fontWeight: 600,
                            color: 'var(--text)',
                          }}
                        >
                          {m.title}
                        </div>
                        <span
                          style={{
                            fontSize: 'var(--fs-xs)',
                            color: 'var(--text-tertiary)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {m.lessons.length} lessons · ~{moduleMinutes} min
                        </span>
                      </div>
                      <ul
                        style={{
                          margin: '10px 0 0',
                          padding: 0,
                          listStyle: 'none',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        {m.lessons.map((l) => (
                          <li
                            key={l.id}
                            data-testid={`stage4-lesson-${l.id}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: 'var(--space-3)',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 'var(--fs-sm)',
                                  fontWeight: 500,
                                  color: 'var(--text)',
                                }}
                              >
                                {l.title}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 'var(--fs-xs)',
                                  color: 'var(--text-tertiary)',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {l.estimatedMinutes} min
                              </span>
                            </div>
                            {l.summary && (
                              <span
                                style={{
                                  marginTop: 2,
                                  fontSize: 'var(--fs-xs)',
                                  color: 'var(--text-secondary)',
                                  lineHeight: 1.45,
                                }}
                              >
                                {l.summary}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {idx < s.modules.length - 1 ? null : null}
                    </div>
                  );
                })}
              </div>

              <div
                data-testid="stage4-cost-estimate"
                style={{
                  marginTop: 'var(--space-6)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--accent-subtle)',
                  color: 'var(--accent-text)',
                  fontSize: 'var(--fs-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Sparkles size={14} strokeWidth={2} />
                <span>
                  ≈ {generationMinutes} minutes to generate, {lessonCount} lessons
                </span>
              </div>

              {submitError && (
                <div
                  data-testid="stage4-error"
                  role="alert"
                  style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
                    color: 'var(--danger, #b91c1c)',
                    fontSize: 'var(--fs-sm)',
                    border: '1px solid var(--danger, #fca5a5)',
                  }}
                >
                  {submitError}
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>
              No structure yet. Go back and build one.
            </p>
          )}
        </div>
      </div>

      {/* Sticky bottom bar */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 'var(--space-4) var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          data-testid="wizard-back"
          onClick={onBack}
          disabled={submitting}
          style={ghostBtnStyle}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </button>
        <button
          type="button"
          data-testid="stage4-generate"
          onClick={onGenerate}
          disabled={!s || submitting}
          style={primaryBtnStyle(!s || submitting)}
        >
          <Sparkles size={14} strokeWidth={2} />
          {submitting ? 'Saving…' : 'Generate course'}
        </button>
      </div>
    </div>
  );
}

// ─── Stage 5 — Generate (live progress) ──────────────────────────────────────

interface ProgressState {
  current: number;
  total: number;
}

type StageStatus = 'started' | 'done' | 'error';

// US-108 — lesson slot in the horizontal progress slider. Sourced from
// GET /api/courses/<slug>/curriculum (course.json once init_course finishes,
// course-spec.json fallback before that).
interface CurriculumLesson {
  slug: string;
  title: string;
  moduleId: string | null;
  moduleTitle: string;
  index: number;
}

type LessonSlotStatus = 'pending' | 'started' | 'done' | 'error';

interface StageEntry {
  name: string;          // SSE stage name ('init_course' or 'lesson:<slug>')
  diskName: string;      // basename used for URL/disk lookup
  status: StageStatus;
  liveLines: string[];   // streamed lines for the active session
  expanded: boolean;
  diskContent: string | null;  // populated lazily from GET /logs/<stage>
  diskLoading: boolean;
  diskError: string | null;
  hydrated: boolean;     // true if seeded from /logs index (page opened mid-run)
}

// Map an SSE stage event name to the on-disk basename used in /logs/<stage>.
// The pipeline emits 'init_course' verbatim and prefixes lesson stages with
// 'lesson:' (see startGenerationInner.runLesson). The disk filename strips
// that prefix.
export function stageDiskName(sseName: string): string {
  return sseName.startsWith('lesson:') ? sseName.slice('lesson:'.length) : sseName;
}

// US-108 — pre-rendered horizontal slider of every planned lesson slot.
//
// Each slot transitions in place from 'pending' → 'started' → 'done' (or
// 'error') as SSE stage events arrive — no new DOM nodes are appended after
// the initial mount. The full lesson title is exposed via the native title
// attribute (tooltip on hover); the visible label is just the 1-based
// "<n>/<total>" counter so a 63-lesson course doesn't overflow the panel.
//
// Layout: overflow-x with scroll-snap so users can flick through slots. The
// container is keyboard-focusable (tabIndex=0); ArrowLeft/ArrowRight scroll
// by one slot at a time and Home/End jump to the ends. Pointer-drag scroll
// is enabled so the slider also feels right on touch / trackpad.
//
// US-109 — pending slots are filtered out; the native scrollbar is hidden
// behind the `lesson-slot-track` CSS class; the L/R arrow buttons disable
// when scrolled to the corresponding edge; mouse-wheel events while
// hovering the row scroll horizontally and stop the page from scrolling
// vertically.
function LessonSlotsSlider({
  lessons,
  statuses,
  activeSlug,
}: {
  lessons: CurriculumLesson[];
  statuses: Map<string, LessonSlotStatus>;
  activeSlug: string | null;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const slotRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [edges, setEdges] = useState<{ atStart: boolean; atEnd: boolean }>({
    atStart: true,
    atEnd: true,
  });

  const total = lessons.length;
  const visibleLessons = useMemo(
    () => visibleLessonSlots(lessons, statuses),
    [lessons, statuses],
  );
  const visibleCount = visibleLessons.length;

  // Keep the active slot in view as generation progresses. We watch the
  // active slug rather than the status map so the scroll only fires on
  // transitions (and not on every re-render that keeps the same slug live).
  useEffect(() => {
    if (!activeSlug) return;
    const el = slotRefs.current.get(activeSlug);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeSlug]);

  // Track scroll position so the L/R arrow buttons can disable at the edges.
  const recomputeEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges(
      computeSliderEdges(track.scrollLeft, track.scrollWidth, track.clientWidth),
    );
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    recomputeEdges();
    track.addEventListener('scroll', recomputeEdges, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(recomputeEdges)
      : null;
    ro?.observe(track);
    return () => {
      track.removeEventListener('scroll', recomputeEdges);
      ro?.disconnect();
    };
  }, [recomputeEdges]);

  // Recompute when the visible slot count changes — new started/done slots
  // can shift scrollWidth and re-enable a previously-disabled arrow.
  useEffect(() => {
    recomputeEdges();
  }, [visibleCount, recomputeEdges]);

  const scrollByOne = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    // Slot widths are uniform; pick the first one as the step amount.
    const firstSlot = track.querySelector('[data-lesson-slot]') as HTMLElement | null;
    const step = firstSlot ? firstSlot.getBoundingClientRect().width + 8 : 80;
    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  }, []);

  // US-109 — wheel-on-hover scrolls the slider horizontally and stops the
  // page from scrolling vertically. React's onWheel uses passive listeners
  // by default so preventDefault() is silently ignored; attach manually.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (e: WheelEvent) => {
      // Whichever axis dominates becomes the horizontal scroll delta — this
      // keeps regular vertical mouse wheels useful and lets actual
      // horizontal trackpad gestures pass through unchanged.
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      track.scrollBy({ left: delta, behavior: 'auto' });
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      track.removeEventListener('wheel', onWheel);
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollByOne(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollByOne(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        trackRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        const t = trackRef.current;
        if (t) t.scrollTo({ left: t.scrollWidth, behavior: 'smooth' });
      }
    },
    [scrollByOne],
  );

  // Pointer-drag scrolling. We commit to drag-mode after a small movement
  // threshold so plain clicks on slots still register normally.
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startScroll: number;
    moved: boolean;
  } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track) return;
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startScroll: track.scrollLeft,
      moved: false,
    };
  }, []);
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const track = trackRef.current;
    if (!drag || !drag.active || !track) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      track.setPointerCapture(e.pointerId);
      track.style.cursor = 'grabbing';
    }
    if (drag.moved) {
      track.scrollLeft = drag.startScroll - dx;
    }
  }, []);
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const track = trackRef.current;
    if (track) {
      track.style.cursor = '';
      try {
        track.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    }
    if (drag) drag.active = false;
  }, []);

  const startedCount = useMemo(() => {
    let n = 0;
    for (const s of statuses.values()) if (s === 'started') n++;
    return n;
  }, [statuses]);
  const doneCount = useMemo(() => {
    let n = 0;
    for (const s of statuses.values()) if (s === 'done') n++;
    return n;
  }, [statuses]);

  return (
    <div
      data-testid="stage5-lesson-slots"
      data-lesson-total={total}
      data-lesson-visible={visibleCount}
      data-lesson-done={doneCount}
      data-lesson-started={startedCount}
      style={{ marginTop: 'var(--space-5)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-secondary)',
        }}
      >
        <span>Lesson progress</span>
        <span data-testid="stage5-lesson-slots-summary">
          {doneCount} / {total} done{startedCount > 0 ? ` · ${startedCount} in progress` : ''}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 6,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
          padding: 6,
        }}
      >
        <button
          type="button"
          aria-label="Scroll lessons left"
          data-testid="stage5-lesson-slots-prev"
          onClick={() => scrollByOne(-1)}
          disabled={edges.atStart}
          style={sliderArrowStyle(edges.atStart)}
        >
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <div
          ref={trackRef}
          tabIndex={0}
          role="listbox"
          aria-label="Lesson generation progress"
          className="lesson-slot-track"
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            flex: 1,
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            scrollPaddingInline: 16,
            outline: 'none',
            cursor: 'grab',
            // Fixed height regardless of lesson count — AC bullet 3.
            height: 64,
            alignItems: 'center',
            paddingInline: 4,
          }}
        >
          {visibleLessons.map((l) => {
            const status = statuses.get(l.slug) ?? 'pending';
            return (
              <LessonSlot
                key={l.slug}
                lesson={l}
                total={total}
                status={status}
                slotRef={(el) => {
                  if (el) slotRefs.current.set(l.slug, el);
                  else slotRefs.current.delete(l.slug);
                }}
              />
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Scroll lessons right"
          data-testid="stage5-lesson-slots-next"
          onClick={() => scrollByOne(1)}
          disabled={edges.atEnd}
          style={sliderArrowStyle(edges.atEnd)}
        >
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

const sliderArrowStyle = (disabled: boolean): CSSProperties => ({
  flexShrink: 0,
  width: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  color: disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  transition: 'opacity var(--t-fast), color var(--t-fast)',
});

function LessonSlot({
  lesson,
  total,
  status,
  slotRef,
}: {
  lesson: CurriculumLesson;
  total: number;
  status: LessonSlotStatus;
  slotRef: (el: HTMLDivElement | null) => void;
}) {
  const palette = lessonSlotPalette(status);
  const labelNumber = lesson.index + 1;
  return (
    <div
      ref={slotRef}
      data-testid={`lesson-slot-${lesson.slug}`}
      data-lesson-slug={lesson.slug}
      data-lesson-index={lesson.index}
      data-status={status}
      title={lesson.title}
      aria-label={`Lesson ${labelNumber} of ${total}: ${lesson.title} (${status})`}
      role="option"
      aria-selected={status === 'started'}
      style={{
        flexShrink: 0,
        scrollSnapAlign: 'center',
        minWidth: 64,
        height: 48,
        padding: '0 12px',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: palette.border,
        borderRadius: 'var(--radius-md)',
        background: palette.background,
        color: palette.color,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        // Smooth color/border transition so the in-place change is visible.
        transition: 'background var(--t-fast), border-color var(--t-fast), color var(--t-fast)',
        boxShadow: status === 'started' ? '0 0 0 2px var(--accent-subtle)' : 'none',
      }}
    >
      <span>
        {labelNumber}/{total}
      </span>
      <LessonSlotIcon status={status} />
    </div>
  );
}

function LessonSlotIcon({ status }: { status: LessonSlotStatus }) {
  if (status === 'done') {
    return <Check size={11} strokeWidth={3} aria-hidden />;
  }
  if (status === 'error') {
    return <AlertTriangle size={11} strokeWidth={2.5} aria-hidden />;
  }
  if (status === 'started') {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 9,
          height: 9,
          borderRadius: '50%',
          border: '1.5px solid currentColor',
          borderTopColor: 'transparent',
          animation: 'us108-slot-spin 0.9s linear infinite',
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'currentColor',
        opacity: 0.4,
      }}
    />
  );
}

function lessonSlotPalette(status: LessonSlotStatus): {
  background: string;
  color: string;
  border: string;
} {
  if (status === 'done') {
    return {
      background: 'var(--success, #10b981)',
      color: 'white',
      border: 'var(--success, #10b981)',
    };
  }
  if (status === 'started') {
    return {
      background: 'var(--accent-subtle)',
      color: 'var(--accent-text)',
      border: 'var(--accent)',
    };
  }
  if (status === 'error') {
    return {
      background: 'var(--danger-subtle, rgba(220, 38, 38, 0.10))',
      color: 'var(--danger, #b91c1c)',
      border: 'var(--danger, #fca5a5)',
    };
  }
  return {
    background: 'var(--bg-subtle, var(--bg-elevated))',
    color: 'var(--text-tertiary)',
    border: 'var(--border)',
  };
}

// One collapsible section per generation stage. The active stage shows the
// streamed liveLines (auto-scrolled). Completed stages show their persisted
// disk log, lazily fetched on first expand. See US-105 AC.
function StageLogSection({
  entry,
  onToggle,
  activeLogElRef,
}: {
  entry: StageEntry;
  onToggle: () => void;
  activeLogElRef: RefObject<HTMLPreElement | null> | null;
}) {
  const isActive = entry.status === 'started';
  const statusBadgeBg =
    entry.status === 'done'
      ? 'var(--success, #10b981)'
      : entry.status === 'error'
        ? 'var(--danger-subtle, rgba(220, 38, 38, 0.10))'
        : 'var(--accent-subtle)';
  const statusBadgeColor =
    entry.status === 'done'
      ? 'white'
      : entry.status === 'error'
        ? 'var(--danger, #b91c1c)'
        : 'var(--accent-text)';

  // US-111: render newest-first. Storage stays chronological (the SSE feed
  // pushes oldest→newest); the panel reverses for display so the most recent
  // line is at the top and visible without scrolling.
  const bodyText = isActive
    ? reverseLiveLogLines(entry.liveLines).join('\n')
    : entry.diskContent !== null
      ? reverseLogLines(entry.diskContent)
      : entry.liveLines.length > 0
        ? reverseLiveLogLines(entry.liveLines).join('\n')
        : '';

  return (
    <div
      data-testid={`stage5-stage-${entry.diskName}`}
      data-stage-name={entry.name}
      data-stage-status={entry.status}
      data-stage-expanded={entry.expanded ? 'true' : 'false'}
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <button
        type="button"
        data-testid={`stage5-stage-toggle-${entry.diskName}`}
        onClick={onToggle}
        aria-expanded={entry.expanded}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          textAlign: 'left',
        }}
      >
        {entry.expanded ? (
          <ChevronDown size={14} strokeWidth={2} />
        ) : (
          <ChevronRight size={14} strokeWidth={2} />
        )}
        <span style={{ flex: 1, fontWeight: 600 }}>{entry.name}</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            fontSize: 10.5,
            background: statusBadgeBg,
            color: statusBadgeColor,
            border:
              entry.status === 'error'
                ? '1px solid var(--danger, #fca5a5)'
                : 'none',
          }}
        >
          {entry.status}
        </span>
      </button>
      {entry.expanded && (
        <pre
          ref={activeLogElRef ?? undefined}
          data-testid={`stage5-stage-log-${entry.diskName}`}
          className="gen-log-scroll"
          style={{
            margin: 0,
            padding: '10px 12px',
            maxHeight: '320px',
            overflow: 'auto',
            background: 'var(--code-bg, #0f172a)',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--code-text, #e2e8f0)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {entry.diskLoading && bodyText.length === 0 ? (
            <span style={{ color: 'var(--text-tertiary)' }}>Loading log…</span>
          ) : entry.diskError && bodyText.length === 0 ? (
            <span style={{ color: 'var(--danger, #b91c1c)' }}>
              Failed to load log: {entry.diskError}
            </span>
          ) : bodyText.length === 0 ? (
            <span style={{ color: 'var(--text-tertiary)' }}>
              {isActive ? 'Waiting for output…' : 'Empty log.'}
            </span>
          ) : (
            bodyText
          )}
        </pre>
      )}
    </div>
  );
}

function Stage5Generate({ slug, onCancelled }: { slug: string; onCancelled: () => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    'starting' | 'queued' | 'running' | 'done' | 'error'
  >('starting');
  const [genId, setGenId] = useState<string | null>(null);
  const [stages, setStages] = useState<StageEntry[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // US-107: when our slug is queued behind another active run, poll
  // /api/courses/active-run to update position and detect when our slug
  // becomes the active run (then transition to 'running' and attach SSE).
  const [queueInfo, setQueueInfo] = useState<{
    position: number;
    total: number;
  } | null>(null);

  // US-108 — pre-rendered lesson slots. Sourced from
  // GET /api/courses/<slug>/curriculum (course.json once init_course finishes,
  // course-spec.json fallback before that).
  const [curriculum, setCurriculum] = useState<CurriculumLesson[] | null>(null);
  const [curriculumSource, setCurriculumSource] = useState<'course' | 'spec' | null>(null);

  // The disk-name of the most recent 'started' stage. Streamed `log` events
  // are appended to this stage's `liveLines`.
  const activeRef = useRef<string | null>(null);
  const phaseRef = useRef(phase);
  const genIdRef = useRef<string | null>(null);
  const cancelInFlightRef = useRef(false);
  // Per-active-stage scroll container. We auto-scroll the active stage to
  // bottom whenever its liveLines grow.
  const activeLogElRef = useRef<HTMLPreElement | null>(null);
  const activeLineCountRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    genIdRef.current = genId;
  }, [genId]);

  const upsertStageStatus = useCallback((sseName: string, status: StageStatus) => {
    const diskName = stageDiskName(sseName);
    setStages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s.diskName === diskName);
      if (status === 'started') {
        // Auto-collapse all previously-expanded entries; expand the new one.
        for (let i = 0; i < next.length; i++) {
          if (next[i].expanded) next[i] = { ...next[i], expanded: false };
        }
      }
      if (idx === -1) {
        next.push({
          name: sseName,
          diskName,
          status,
          liveLines: [],
          expanded: status === 'started' || status === 'error',
          diskContent: null,
          diskLoading: false,
          diskError: null,
          hydrated: false,
        });
      } else {
        const existing = next[idx];
        next[idx] = {
          ...existing,
          name: sseName,
          status,
          // On a fresh 'started', clear stale streamed lines from a prior
          // session but keep diskContent so the user's expand still has it.
          liveLines: status === 'started' ? [] : existing.liveLines,
          expanded:
            status === 'started'
              ? true
              : status === 'error'
                ? true
                : existing.expanded,
        };
      }
      return next;
    });
    if (status === 'started') {
      activeRef.current = diskName;
      // Reset the auto-scroll counter so the new active stage starts scrolled.
      activeLineCountRef.current = 0;
    }
  }, []);

  const appendLogToActive = useCallback((line: string) => {
    const active = activeRef.current;
    if (!active) return;
    setStages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s.diskName === active);
      if (idx === -1) return prev;
      const cur = next[idx];
      const liveLines = [...cur.liveLines, line];
      // Keep buffer bounded so very long runs don't OOM the browser.
      if (liveLines.length > 5000) liveLines.splice(0, liveLines.length - 5000);
      next[idx] = { ...cur, liveLines };
      return next;
    });
  }, []);

  const setStageExpanded = useCallback((diskName: string, expanded: boolean) => {
    setStages((prev) => {
      const idx = prev.findIndex((s) => s.diskName === diskName);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], expanded };
      return next;
    });
  }, []);

  const fetchStageDiskContent = useCallback(
    async (diskName: string) => {
      setStages((prev) => {
        const idx = prev.findIndex((s) => s.diskName === diskName);
        if (idx === -1) return prev;
        if (prev[idx].diskLoading) return prev;
        if (prev[idx].diskContent !== null) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], diskLoading: true, diskError: null };
        return next;
      });
      try {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(slug)}/logs/${encodeURIComponent(diskName)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          const message = res.status === 404 ? 'Log not yet on disk' : `Server returned ${res.status}`;
          setStages((prev) => {
            const idx = prev.findIndex((s) => s.diskName === diskName);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], diskLoading: false, diskError: message };
            return next;
          });
          return;
        }
        const text = await res.text();
        setStages((prev) => {
          const idx = prev.findIndex((s) => s.diskName === diskName);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            diskContent: text,
            diskLoading: false,
            diskError: null,
          };
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStages((prev) => {
          const idx = prev.findIndex((s) => s.diskName === diskName);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], diskLoading: false, diskError: message };
          return next;
        });
      }
    },
    [slug],
  );

  const handleToggle = useCallback(
    (entry: StageEntry) => {
      const willExpand = !entry.expanded;
      setStageExpanded(entry.diskName, willExpand);
      // Lazy-load disk content on first expand of a non-active stage.
      if (
        willExpand &&
        entry.status !== 'started' &&
        entry.diskContent === null &&
        !entry.diskLoading
      ) {
        void fetchStageDiskContent(entry.diskName);
      }
    },
    [fetchStageDiskContent, setStageExpanded],
  );

  // US-108 — fetch the planned lesson list so the progress slider can
  // pre-render every slot before per-lesson generation starts. Refetched
  // when init_course finishes so we can upgrade from the spec-derived
  // placeholder slugs (slugify(title)) to the canonical course.json slugs.
  const refetchCurriculum = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(slug)}/curriculum`,
        { cache: 'no-store' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        source: 'course' | 'spec';
        total: number;
        lessons: CurriculumLesson[];
      };
      setCurriculum(data.lessons);
      setCurriculumSource(data.source);
    } catch {
      /* best-effort — placeholders just stay empty if fetch fails */
    }
  }, [slug]);

  useEffect(() => {
    void refetchCurriculum();
  }, [refetchCurriculum]);

  // Once we have authoritative course.json data we can stop polling.
  const initCourseDone = useMemo(
    () =>
      stages.some(
        (s) => s.diskName === 'init_course' && (s.status === 'done' || s.status === 'error'),
      ),
    [stages],
  );
  useEffect(() => {
    if (!initCourseDone) return;
    if (curriculumSource === 'course') return;
    void refetchCurriculum();
  }, [initCourseDone, curriculumSource, refetchCurriculum]);

  // Derive lesson statuses from the SSE stage events. The map is keyed by
  // the lesson slug (stage diskName for `lesson:<slug>` entries). Slots not
  // present in the map render as 'pending'.
  const lessonStatuses = useMemo(() => {
    const map = new Map<string, LessonSlotStatus>();
    for (const s of stages) {
      if (!s.name.startsWith('lesson:')) continue;
      map.set(s.diskName, s.status as LessonSlotStatus);
    }
    return map;
  }, [stages]);

  const activeLessonSlug = useMemo(() => {
    for (const [k, v] of lessonStatuses) {
      if (v === 'started') return k;
    }
    return null;
  }, [lessonStatuses]);

  // Hydrate completed stages from /api/courses/<slug>/logs (collapsed).
  // This runs before SSE attaches so that stages already on disk are visible
  // even before any live event arrives. AC: "When the generation page is
  // opened mid-run for a slug that already has logs on disk, all completed
  // stages are shown collapsed with their persisted content available".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/courses/${encodeURIComponent(slug)}/logs`, {
          cache: 'no-store',
        });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { stages?: { stage: string }[] };
        if (cancelled || !Array.isArray(data.stages)) return;
        setStages((prev) => {
          if (prev.length > 0) return prev; // SSE already added live entries
          return data.stages!.map((s) => ({
            name: s.stage === 'init_course' ? 'init_course' : `lesson:${s.stage}`,
            diskName: s.stage,
            status: 'done' as StageStatus,
            liveLines: [],
            expanded: false,
            diskContent: null,
            diskLoading: false,
            diskError: null,
            hydrated: true,
          }));
        });
      } catch {
        /* hydration is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Kick off the run and subscribe to its SSE stream.
  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let queuePollTimer: ReturnType<typeof setInterval> | null = null;

    const attachStream = (id: string) => {
      eventSource = new EventSource(`/api/courses/generate/stream/${id}`);
      wireStreamHandlers(eventSource);
    };

    const wireStreamHandlers = (es: EventSource) => {
      es.addEventListener('log', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { line: string };
          appendLogToActive(data.line);
        } catch {
          /* malformed event */
        }
      });
      es.addEventListener('stage', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as {
            name: string;
            status: StageStatus;
          };
          upsertStageStatus(data.name, data.status);
        } catch {
          /* malformed */
        }
      });
      es.addEventListener('progress', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { current: number; total: number };
          setProgress({ current: data.current, total: data.total });
        } catch {
          /* malformed */
        }
      });
      es.addEventListener('done', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data) as { courseSlug: string };
          setPhase('done');
          es.close();
          // Tiny delay so the user sees the success state before the page swap.
          window.setTimeout(() => {
            router.push(`/courses/${data.courseSlug}`);
          }, 600);
        } catch {
          /* malformed */
        }
      });
      es.addEventListener('error', (ev: MessageEvent) => {
        // SSE built-in onerror fires with no data; only treat as fatal if
        // the payload says so (i.e. our structured `error` event).
        if (typeof (ev as MessageEvent).data === 'string' && ev.data.length > 0) {
          try {
            const data = JSON.parse(ev.data) as { message: string };
            setErrorMessage(data.message);
            setPhase('error');
            es.close();
          } catch {
            /* network blip — let the browser auto-reconnect */
          }
        }
      });
    };

    const promoteToRunning = async (): Promise<boolean> => {
      // The queued slug just became active. POST again to retrieve the
      // SSE id (idempotent, US-105) then attach the stream.
      try {
        const res = await fetch('/api/courses/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        if (cancelled) return true;
        if (!res.ok) return false;
        const body = (await res.json()) as
          | { id: string; slug: string }
          | { queued: true; slug: string; position: number; total: number };
        if ('id' in body) {
          setGenId(body.id);
          genIdRef.current = body.id;
          setQueueInfo(null);
          setPhase('running');
          attachStream(body.id);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    const startQueuePolling = () => {
      if (queuePollTimer) return;
      queuePollTimer = setInterval(() => {
        void (async () => {
          if (cancelled) return;
          try {
            const res = await fetch('/api/courses/active-run', { cache: 'no-store' });
            if (cancelled || !res.ok) return;
            const body = (await res.json()) as ActiveRunResponse;
            if (cancelled) return;
            if (body.active && body.slug === slug) {
              // Our slug is now the active run. Stop polling, attach SSE.
              if (queuePollTimer) {
                clearInterval(queuePollTimer);
                queuePollTimer = null;
              }
              await promoteToRunning();
              return;
            }
            const ourEntry = body.queue.find((e) => e.slug === slug);
            if (ourEntry) {
              setQueueInfo({ position: ourEntry.position, total: body.queue.length });
            }
            // If we're not in queue and not active, we may have been picked
            // up since the last poll — try to promote.
            if (!ourEntry && body.active && body.slug !== slug) {
              // Still queued behind a different active run — stay put.
            }
          } catch {
            /* transient network — try again next tick */
          }
        })();
      }, 1500);
    };

    const start = async () => {
      try {
        // Brief retry on 409 GenerationConflictError. Server-side
        // startGeneration is already idempotent for the same slug once an
        // active run exists, but there's a tiny window during the very
        // first POST where the reservation flag is set BEFORE activeRun
        // is — a concurrent retry (e.g. React StrictMode dev double-mount)
        // can land in that window and 409. A short backoff loop walks past
        // it without bothering the user.
        let res: Response | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (cancelled) return;
          res = await fetch('/api/courses/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug }),
          });
          if (cancelled) return;
          if (res.status !== 409) break;
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
        if (cancelled) return;
        if (!res) {
          setErrorMessage('Failed to start generation');
          setPhase('error');
          return;
        }
        if (res.status === 503) {
          let message = 'Install Claude Code CLI or sign in to Claude Max';
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') message = body.error;
          } catch {
            /* non-JSON body */
          }
          setErrorMessage(message);
          setPhase('error');
          return;
        }
        if (!res.ok) {
          let message = `Server returned ${res.status}`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === 'string') message = body.error;
          } catch {
            /* non-JSON body */
          }
          setErrorMessage(message);
          setPhase('error');
          return;
        }
        const body = (await res.json()) as
          | { id: string; slug: string }
          | { queued: true; slug: string; position: number; total: number };

        // US-107: when another generation is already running, the server
        // enqueues us instead of starting immediately. Show "W kolejce —
        // <position>/<total>" and poll active-run until our turn arrives.
        if ('queued' in body && body.queued) {
          setQueueInfo({ position: body.position, total: body.total });
          setPhase('queued');
          startQueuePolling();
          return;
        }
        if (!('id' in body)) {
          setErrorMessage('Server returned an unexpected response');
          setPhase('error');
          return;
        }
        setGenId(body.id);
        genIdRef.current = body.id;
        setPhase('running');

        attachStream(body.id);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          /* already closed */
        }
      }
      if (queuePollTimer) {
        clearInterval(queuePollTimer);
        queuePollTimer = null;
      }
      // US-106: closing the tab MUST NOT kill the server-side run — the resume
      // banner depends on the child still being alive when the user returns.
      // Cancellation is explicit only (Cancel button → handleCancelClick).
    };
  }, [slug, router, appendLogToActive, upsertStageStatus]);

  const handleCancelClick = async () => {
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    const id = genIdRef.current;
    if (id) {
      try {
        await fetch(`/api/courses/generate?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
    }
    onCancelled();
  };

  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : null;

  // US-111: newest entries render at the top, so keep the active stage's
  // pre pinned to scrollTop=0 when its liveLines grow. The previous behavior
  // (scrollTop = scrollHeight) auto-scrolled to bottom and is no longer
  // appropriate now that the newest line is the first child of the panel.
  const activeStage = stages.find((s) => s.diskName === activeRef.current && s.status === 'started');
  useEffect(() => {
    const el = activeLogElRef.current;
    if (!el) return;
    if (!activeStage) return;
    if (activeStage.liveLines.length === activeLineCountRef.current) return;
    activeLineCountRef.current = activeStage.liveLines.length;
    el.scrollTop = 0;
  }, [activeStage]);

  const totalLogLines = useMemo(
    () => stages.reduce((sum, s) => sum + s.liveLines.length, 0),
    [stages],
  );

  return (
    <div style={stageWrapStyle}>
      <div
        data-testid="stage5-generate"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-7) var(--space-6)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 820, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Stage 6 of 6 · Generating
          </div>

          <h1
            data-testid="stage5-headline"
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            {phase === 'done'
              ? 'Course generated'
              : phase === 'error'
                ? 'Generation failed'
                : phase === 'queued'
                  ? 'Twoja generacja czeka w kolejce'
                  : 'Generating your course…'}
          </h1>
          {phase === 'queued' && queueInfo && (
            <p
              data-testid="stage5-queued-status"
              data-queue-position={queueInfo.position}
              data-queue-total={queueInfo.total}
              style={{
                marginTop: 'var(--space-3)',
                fontSize: 'var(--fs-md)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-text)',
              }}
            >
              W kolejce — {queueInfo.position}/{queueInfo.total}
            </p>
          )}
          <p
            style={{
              marginTop: 6,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.55,
            }}
          >
            {phase === 'done'
              ? 'Redirecting to your course…'
              : phase === 'error'
                ? 'See details below — or go back to fix the issue and try again.'
                : phase === 'queued'
                  ? 'Inny kurs jest właśnie generowany. Twój start nastąpi automatycznie, gdy tamten się zakończy.'
                  : 'Hang tight — Claude is researching the topic, then ralph will write each lesson.'}
          </p>

          {progressPercent !== null && phase !== 'error' && (
            <div
              data-testid="stage5-progress"
              data-progress-current={progress?.current}
              data-progress-total={progress?.total}
              style={{ marginTop: 'var(--space-5)' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>Lessons</span>
                <span>
                  {progress?.current} / {progress?.total}
                </span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-active)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          )}

          {curriculum && curriculum.length > 0 && (
            <LessonSlotsSlider
              lessons={curriculum}
              statuses={lessonStatuses}
              activeSlug={activeLessonSlug}
            />
          )}

          {phase === 'error' && errorMessage && (
            <div
              data-testid="stage5-error"
              role="alert"
              style={{
                marginTop: 'var(--space-5)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-subtle, rgba(220, 38, 38, 0.08))',
                color: 'var(--danger, #b91c1c)',
                border: '1px solid var(--danger, #fca5a5)',
                fontSize: 'var(--fs-sm)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{errorMessage}</div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', opacity: 0.85 }}>
                Expand any stage below to review its full log.
              </div>
            </div>
          )}

          <div
            data-testid="stage5-log-panel"
            style={{
              marginTop: 'var(--space-5)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              Generation log {totalLogLines > 0 && `(${totalLogLines} lines)`}
            </div>
            {stages.length === 0 ? (
              <div
                style={{
                  padding: '14px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: 'var(--text-tertiary)',
                }}
              >
                {phase === 'error' ? 'No stages started.' : 'Waiting for output…'}
              </div>
            ) : (
              stages.map((entry) => (
                <StageLogSection
                  key={entry.diskName}
                  entry={entry}
                  onToggle={() => handleToggle(entry)}
                  activeLogElRef={
                    entry.status === 'started' ? activeLogElRef : null
                  }
                />
              ))
            )}
          </div>

          <div
            style={{
              marginTop: 'var(--space-5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
            }}
          >
            {phase === 'running' && (
              <button
                type="button"
                data-testid="stage5-cancel"
                onClick={handleCancelClick}
                style={ghostBtnStyle}
              >
                Cancel
              </button>
            )}
            {phase === 'error' && (
              <button
                type="button"
                data-testid="stage5-back"
                onClick={onCancelled}
                style={ghostBtnStyle}
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to approval
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({
  onBack,
  onNext,
  canNext = false,
  backLabel,
  nextLabel = 'Next',
  hideNext = false,
}: {
  onBack: () => void;
  onNext?: () => void;
  canNext?: boolean;
  backLabel: string;
  nextLabel?: string;
  hideNext?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <button
        type="button"
        data-testid="wizard-back"
        onClick={onBack}
        style={ghostBtnStyle}
      >
        <ArrowLeft size={14} strokeWidth={2} />
        {backLabel}
      </button>
      {!hideNext && onNext ? (
        <button
          type="button"
          data-testid="wizard-next"
          onClick={onNext}
          disabled={!canNext}
          style={primaryBtnStyle(!canNext)}
        >
          {nextLabel}
          <ArrowRight size={14} strokeWidth={2} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: CSSProperties = {
  height: 64,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 var(--space-6)',
};

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const stageWrapStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  marginBottom: 14,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--text)',
};

function chipStyle(selected: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    height: 32,
    padding: '0 14px',
    background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--fs-sm)',
    color: selected ? 'var(--accent-text)' : 'var(--text-secondary)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color var(--t-fast), background var(--t-fast), color var(--t-fast)',
  };
}

function radioCardStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    textAlign: 'left',
    padding: 'var(--space-4)',
    background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-md)',
    color: selected ? 'var(--accent-text)' : 'var(--text)',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'border-color var(--t-fast), background var(--t-fast), color var(--t-fast)',
  };
}

const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

function primaryBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    padding: '0 18px',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    transition: 'background var(--t-fast), opacity var(--t-fast)',
  };
}
