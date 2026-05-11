// Mock claude -p stand-in for the research_course stage that emulates the
// pre-fix bug: prints "Unknown command:" and exits 0 without ever writing
// research.md / sources.md. Pairs with the post-research guard in
// generation.ts so the playwright test for that error path runs without
// depending on a real claude binary. Mirrors the older initCourseBroken
// behaviour now that init_course is split into research_course +
// design_course; research is the first stage so this broken variant covers
// the same "first claude call silently no-ops" failure mode.
//
// Spawned by defaultResearchCourseCommand() when:
//   GENERATION_MOCK === 'broken'                                  (always broken), or
//   GENERATION_MOCK === '1' && slug.startsWith('broken-')         (per-slug broken).
//
// No argv params.

console.log('Unknown command: /research_course');
process.exit(0);
