// Mock claude -p stand-in for the coherence_pass stage. Emits a static,
// valid coherence report (three sections matching the AC) on stdout. The
// orchestrator captures stdout and writes it verbatim to
// /courses/<slug>/coherence-report.md, so the playwright test for the
// post-generation flow can run without depending on a real claude binary.
//
// Spawned by defaultCoherencePassCommand() when GENERATION_MOCK === '1'.
//
// No argv params.

process.stdout.write(
  '## Prerequisite Order\n\nNo issues found.\n\n' +
    '## Redundancy\n\nNo issues found.\n\n' +
    '## Notation Consistency\n\nNo issues found.\n',
);
