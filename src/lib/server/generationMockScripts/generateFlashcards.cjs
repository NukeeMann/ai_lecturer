// Mock claude -p stand-in for the generate_flashcards stage. Writes a stub
// <coursesRoot>/<slug>/flashcards/<moduleId>.json that validates against
// FlashcardDeckSchema: one basic card per lesson of the module plus one
// cloze card.
//
// Spawned by defaultFlashcardsCommand() when GENERATION_MOCK === '1'.
//
// argv[2] = slug       (already validated by assertSafeSlug before spawn)
// argv[3] = moduleId   (already validated by assertSafeSlug before spawn)
//
// Honours COURSES_ROOT_OVERRIDE so per-test tmpdirs work the same as the
// production courses/ root.

const fs = require('fs');
const path = require('path');

const slug = process.argv[2];
const moduleId = process.argv[3];

if (!slug || !moduleId) {
  console.error('generateFlashcards mock: requires argv[2]=slug and argv[3]=moduleId');
  process.exit(2);
}

const root = process.env.COURSES_ROOT_OVERRIDE || path.join(process.cwd(), 'courses');
const course = JSON.parse(fs.readFileSync(path.join(root, slug, 'course.json'), 'utf8'));
const mod = (course.modules || []).find((m) => m.id === moduleId);
const lessons = mod ? mod.lessons : [];

const cards = lessons.map((l) => ({
  id: `about-${l.slug}`.slice(0, 80),
  kind: 'basic',
  front: `What is the lesson "${l.title}" about?`,
  back: l.summary || l.title,
  lessonSlug: l.slug,
}));
cards.push({
  id: 'module-title',
  kind: 'cloze',
  text: `This module is called {{c1::${mod ? mod.title : moduleId}}}.`,
});

const dir = path.join(root, slug, 'flashcards');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(
  path.join(dir, `${moduleId}.json`),
  JSON.stringify({ schemaVersion: 1, courseSlug: slug, moduleId, cards }, null, 2) + '\n',
);
console.log(`mock: wrote flashcards/${moduleId}.json (${cards.length} cards)`);
