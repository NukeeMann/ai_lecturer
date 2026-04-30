// Playwright end-to-end walk for US-026 (Stage 4 Approval + Stage 5 Export).
// Walks the wizard 1→2→3→4→5, verifies the success card, and reads the
// resulting course-spec.json from disk to confirm contents.

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL = 'http://localhost:3026';
const COURSES_ROOT = '/tmp/us026-courses';

const checks = [];
function assert(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  // ─── Stage 1 ───
  await page.goto(`${TARGET_URL}/create`, { waitUntil: 'networkidle' });
  assert('Stage 1 input present', await page.locator('[data-testid="stage1-topic-input"]').count() === 1);
  await page.fill('[data-testid="stage1-topic-input"]', 'How transformers actually work');
  await page.click('[data-testid="wizard-next"]');

  // ─── Stage 2 ───
  await page.waitForSelector('[data-testid="stage2-level-group"]');
  await page.click('[data-testid="stage2-level-beginner"]');
  await page.click('[data-testid="stage2-duration-1h"]');
  // slider already 50
  await page.click('[data-testid="wizard-next"]');

  // ─── Stage 3 ───
  await page.waitForSelector('[data-testid="stage3-cascade"]', { timeout: 5000 }).catch(() => {});
  // The cascade has its own root; we just need to see at least one module card.
  await page.waitForSelector('[data-testid^="stage3-module-card-"]', { timeout: 5000 });
  // Advance straight to Stage 4 with the seeded structure.
  await page.click('[data-testid="wizard-next"]');

  // ─── Stage 4 ───
  await page.waitForSelector('[data-testid="stage4-approval"]', { timeout: 5000 });

  // Course title from Stage 1 should appear (capitalized "How transformers actually work")
  const courseTitle = await page.locator('[data-testid="stage4-course-title"]').textContent();
  assert('Stage 4 shows course title', /transformers/i.test(courseTitle || ''), courseTitle || '');

  const desc = await page.locator('[data-testid="stage4-course-description"]').textContent();
  assert('Stage 4 description includes "beginner-friendly"', /beginner-friendly/i.test(desc || ''));

  // Cost estimate line — lessonCount * 3 = 12 lessons * 3 = 36 minutes
  const cost = await page.locator('[data-testid="stage4-cost-estimate"]').textContent();
  assert('Stage 4 cost estimate format', /≈\s*\d+\s*minutes to generate,\s*\d+\s*lessons/.test(cost || ''), cost || '');
  assert('Stage 4 cost estimate uses lessonCount*3', /36 minutes/.test(cost || '') && /12 lessons/.test(cost || ''), cost || '');

  // Total time line
  const totals = await page.locator('[data-testid="stage4-totals"]').textContent();
  assert('Stage 4 totals line shows count of lessons + total mins', /3 modules/.test(totals || '') && /12 lessons/.test(totals || '') && /min total/.test(totals || ''), totals || '');

  // Per-module: title visible + each lesson row has a description (summary) and minutes
  const moduleCards = await page.locator('[data-testid^="stage4-module-"]:not([data-testid^="stage4-module-title-"])').count();
  assert('Stage 4 renders 3 module cards', moduleCards === 3, String(moduleCards));

  const lessonRows = await page.locator('[data-testid^="stage4-lesson-"]').count();
  assert('Stage 4 renders 12 lesson rows total', lessonRows === 12, String(lessonRows));

  // Verify a lesson row contains a "min" suffix
  const firstLessonText = await page.locator('[data-testid^="stage4-lesson-"]').first().textContent();
  assert('Stage 4 lesson row shows estimatedMinutes', /\d+ min/.test(firstLessonText || ''), firstLessonText || '');

  // Generate button present
  const genBtn = page.locator('[data-testid="stage4-generate"]');
  assert('Stage 4 has Generate course button', await genBtn.count() === 1);
  const genText = await genBtn.textContent();
  assert('Generate button label is "Generate course"', /Generate course/.test(genText || ''), genText || '');
  assert('Generate button enabled', !(await genBtn.isDisabled()));

  // ─── Click Generate → POST /api/courses → Stage 5 ───
  await genBtn.click();
  await page.waitForSelector('[data-testid="stage5-export"]', { timeout: 5000 });

  // The seeded courseTitle is "How transformers actually work" → slug "how-transformers-actually-work"
  const expectedSlug = 'how-transformers-actually-work';
  const specPathLoc = await page.locator('[data-testid="stage5-spec-path"]').textContent();
  assert('Stage 5 spec path uses derived slug', specPathLoc === `/courses/${expectedSlug}/course-spec.json`, specPathLoc || '');

  const confirm = await page.locator('[data-testid="stage5-confirm"]').textContent();
  assert('Stage 5 confirmation copy mentions saved + path', /Course spec saved to/.test(confirm || '') && new RegExp(expectedSlug).test(confirm || ''), confirm || '');

  // 3 command rows
  for (const id of ['stage5-cmd-claude', 'stage5-cmd-init', 'stage5-cmd-ralph']) {
    const txt = await page.locator(`[data-testid="${id}-text"]`).textContent();
    assert(`Stage 5 ${id} command visible`, !!txt && txt.trim().length > 0, txt || '');
  }
  const initCmd = await page.locator('[data-testid="stage5-cmd-init-text"]').textContent();
  assert('Stage 5 init command names the slug', new RegExp(expectedSlug).test(initCmd || '') && /init_course/.test(initCmd || ''), initCmd || '');

  const ralphCmd = await page.locator('[data-testid="stage5-cmd-ralph-text"]').textContent();
  assert('Stage 5 ralph command shows ralph.sh path', /ralph\.sh/.test(ralphCmd || ''), ralphCmd || '');

  // Copy buttons exist on every command row
  for (const id of ['stage5-cmd-claude', 'stage5-cmd-init', 'stage5-cmd-ralph']) {
    const cnt = await page.locator(`[data-testid="${id}-copy"]`).count();
    assert(`Stage 5 ${id} has Copy button`, cnt === 1);
  }

  // Friendly note + Back to dashboard link
  const note = await page.locator('[data-testid="stage5-note"]').textContent();
  assert('Stage 5 friendly note present', /once generation completes/i.test(note || ''), note || '');
  const backLink = page.locator('[data-testid="stage5-back-to-dashboard"]');
  assert('Stage 5 has Back to dashboard link', await backLink.count() === 1);
  assert('Back link href is /', (await backLink.getAttribute('href')) === '/', await backLink.getAttribute('href'));

  // ─── Verify on disk ───
  const specPath = path.join(COURSES_ROOT, expectedSlug, 'course-spec.json');
  assert('course-spec.json exists at expected path', fs.existsSync(specPath), specPath);
  const raw = fs.readFileSync(specPath, 'utf8');
  let spec;
  try { spec = JSON.parse(raw); } catch (err) { spec = null; }
  assert('course-spec.json parses as JSON', !!spec);
  assert('spec.topic matches Stage 1 input', spec && spec.topic === 'How transformers actually work', spec && spec.topic);
  assert('spec.level matches Stage 2 selection', spec && spec.level === 'beginner', spec && spec.level);
  assert('spec.durationTarget matches Stage 2 selection', spec && spec.durationTarget === '1h', spec && spec.durationTarget);
  assert('spec.theoryPracticeRatio is 0..1 (0.5)', spec && spec.theoryPracticeRatio === 0.5, spec && String(spec.theoryPracticeRatio));
  assert('spec.draftStructure has 3 modules', spec && spec.draftStructure && spec.draftStructure.modules.length === 3, spec && spec.draftStructure && String(spec.draftStructure.modules.length));
  const totalLessons = spec && spec.draftStructure
    ? spec.draftStructure.modules.reduce((s, m) => s + m.lessons.length, 0)
    : 0;
  assert('spec total lessons = 12', totalLessons === 12, String(totalLessons));
  // No client-side ids in serialized spec
  const moduleHasNoId = spec && spec.draftStructure && spec.draftStructure.modules.every((m) => !('id' in m));
  assert('spec modules have no `id` field', moduleHasNoId);
  const lessonHasNoId = spec && spec.draftStructure && spec.draftStructure.modules.every((m) => m.lessons.every((l) => !('id' in l)));
  assert('spec lessons have no `id` field', lessonHasNoId);
  assert('spec.createdAt is ISO 8601 string', spec && typeof spec.createdAt === 'string' && /\d{4}-\d{2}-\d{2}T/.test(spec.createdAt), spec && spec.createdAt);

  // ─── 409 path: walk a fresh wizard with the same title and confirm the prompt fires ───
  // Close any existing dialogs
  page.removeAllListeners('dialog');
  let promptFired = false;
  let secondPostStatus = null;
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') {
      promptFired = true;
      await d.accept('Different title for retry');
    } else {
      await d.accept();
    }
  });
  // Listen for the response on the retry POST
  page.on('response', (resp) => {
    if (resp.url().endsWith('/api/courses') && resp.request().method() === 'POST') {
      secondPostStatus = resp.status();
    }
  });

  await page.goto(`${TARGET_URL}/create`, { waitUntil: 'networkidle' });
  await page.fill('[data-testid="stage1-topic-input"]', 'How transformers actually work');
  await page.click('[data-testid="wizard-next"]');
  await page.waitForSelector('[data-testid="stage2-level-group"]');
  await page.click('[data-testid="stage2-level-beginner"]');
  await page.click('[data-testid="stage2-duration-1h"]');
  await page.click('[data-testid="wizard-next"]');
  await page.waitForSelector('[data-testid^="stage3-module-card-"]', { timeout: 5000 });
  await page.click('[data-testid="wizard-next"]');
  await page.waitForSelector('[data-testid="stage4-approval"]');
  await page.click('[data-testid="stage4-generate"]');
  await page.waitForSelector('[data-testid="stage5-export"]', { timeout: 8000 });

  assert('409 collision triggers a window.prompt', promptFired);
  // After accepting prompt with new title, the retry should land at stage 5 with new slug
  const newSpecPath = await page.locator('[data-testid="stage5-spec-path"]').textContent();
  assert('After retry, slug derives from new title', /different-title-for-retry/.test(newSpecPath || ''), newSpecPath || '');
  const retryDiskPath = path.join(COURSES_ROOT, 'different-title-for-retry', 'course-spec.json');
  assert('Retry course-spec written under new slug', fs.existsSync(retryDiskPath), retryDiskPath);

  // ─── No console errors ───
  // The 409 console error is expected (we deliberately trigger a slug collision in the retry test).
  const ignorable = consoleErrors.filter((e) => !/favicon/.test(e) && !/status of 409/.test(e));
  assert('No console errors', ignorable.length === 0, ignorable.join(' | '));

  await page.screenshot({ path: '/tmp/us026-stage5.png', fullPage: true });

  await browser.close();

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} assertions passed`);
  if (passed !== total) {
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('FATAL:', e);
  process.exitCode = 2;
});
