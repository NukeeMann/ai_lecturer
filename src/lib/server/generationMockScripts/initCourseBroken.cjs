// Mock claude -p stand-in for the init_course stage that emulates the
// pre-fix bug: prints "Unknown command:" and exits 0 without ever writing
// course.json. Pairs with the post-init guard in generation.ts so the
// playwright test for that error path runs without depending on a real
// claude binary.
//
// Spawned by defaultInitCourseCommand() when:
//   GENERATION_MOCK === 'broken'                                  (always broken), or
//   GENERATION_MOCK === '1' && slug.startsWith('broken-')         (per-slug broken).
//
// No argv params.

console.log('Unknown command: /init_course');
process.exit(0);
