// The single source of truth for WHICH fields get language-polished.
//
// Everything not listed here is FROZEN — never sent to Gemini for rewrite:
// all code (starterCode/solution/tests.body/sourceCode/renderCode/template),
// all src/url, all id/key/name-used-as-key, numeric arrays/bounds, quiz
// `correct` indices, dragMatch `accepts`, transcript text + wordIndex + answer,
// PlotImage `alt`, figure numbers, and any LaTeX/code/URL spans embedded inside
// prose (those are additionally protected byte-for-byte in protectedTokens.mjs).
//
// Path template syntax: dotted, with `[]` meaning "for each element of this
// array". Expanded to concrete index paths by the walker.

export const LESSON_FIELDS = ['title', 'eyebrow', 'description'];

// Applied to every section regardless of type.
export const SECTION_COMMON = ['title', 'description'];

// Applied to lesson.sources[] and section.sources[].
export const SOURCE_FIELDS = ['title'];

export const POLISHABLE_BY_TYPE = {
  theory: ['data.markdown'],
  quiz: ['data.question', 'data.options[]', 'data.explanation'],
  code: ['data.taskMarkdown'],
  sandbox: ['data.encouragement'],
  codeCloze: ['data.taskMarkdown', 'data.hints[].markdown', 'data.slots[].hint'],
  dragMatch: ['data.prompt', 'data.items[].label', 'data.zones[].label', 'data.explanation'],
  transcriptCloze: ['data.title', 'data.instructions', 'data.blanks[].hint'],
  plotImage: ['data.caption'],
  // audioPlayer.transcript IS prose (no word-index anchoring) but polishing it
  // may desync pre-synthesized audio — always flagged in the report.
  audioPlayer: ['data.title', 'data.transcript'],
  // video.transcript[] is time-aligned (tStart/tEnd) -> FROZEN. Only the title.
  video: ['data.title'],
  sttDemo: ['data.prompt'],
  ttsDemo: ['data.defaultText', 'data.placeholderText'],
  // demo, histogram, dataTable, parametricExplorer, custom: nothing prose-bearing
  // beyond SECTION_COMMON (their data is numeric/code/identifiers).
};

// Section types we know carry no extra polishable prose. Used to avoid logging
// a spurious "unmapped type" warning for them.
export const KNOWN_NO_EXTRA_PROSE = new Set([
  'demo',
  'histogram',
  'dataTable',
  'parametricExplorer',
  'custom',
]);
