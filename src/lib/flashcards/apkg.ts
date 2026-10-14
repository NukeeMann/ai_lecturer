// Builds an Anki package (.apkg) for a whole course: one parent deck named
// after the course, one subdeck per module ("Course::01 · Module title").
//
// Format: the legacy "collection.anki2" package (schema v11) — a zip with a
// SQLite collection plus a `media` JSON map. Every Anki client still imports
// it (desktop, AnkiDroid, AnkiMobile), which is what makes "download → tap →
// it's in Anki" work without the CSV field-mapping dialog.
//
// Re-import behaviour hinges on stable identifiers, so nothing here is random:
//   - note GUID   = hash(course slug, module id, card id) → Anki matches the
//                   note on re-import and updates it instead of duplicating;
//                   review history stays with the existing cards.
//   - notetype ids are fixed constants shared by every course, so repeated
//                   imports reuse the same three note types.
//   - deck / note / card ids are derived from the same hashes.
// Note `mod` is the build time, so a rebuilt deck counts as "newer" and
// Anki's default "update if newer" policy applies the regenerated text.

import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

import {
  CLOZE_DELETION_RE,
  type Flashcard,
} from '@/lib/schemas/flashcards';
import { markdownToAnkiHtml, stripHtml } from './fieldHtml';

export interface ApkgModuleInput {
  moduleId: string;
  title: string;
  cards: Flashcard[];
}

export interface BuildApkgInput {
  courseSlug: string;
  courseTitle: string;
  courseDescription?: string;
  // Course order; empty modules are skipped.
  modules: ApkgModuleInput[];
  // lessonSlug → lesson title, shown as the small source line on answers.
  lessonTitles?: Record<string, string>;
  now?: Date;
}

const FIELD_SEP = '\x1f';
const BASE91 =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

function sha256(text: string): Buffer {
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

// Positive id in the same magnitude as Anki's millisecond-timestamp ids,
// well inside Number.MAX_SAFE_INTEGER.
function stableId(key: string): number {
  const h = sha256(key);
  const low40 = h.readUIntBE(0, 5); // 40 bits
  return 1_000_000_000_000 + low40;
}

// Anki-style 10-char base91 GUID from the first 64 bits of a hash.
export function noteGuid(courseSlug: string, moduleId: string, cardId: string): string {
  let n = sha256(`ai-lecturer|${courseSlug}|${moduleId}|${cardId}`).readBigUInt64BE(0);
  const radix = BigInt(BASE91.length);
  let out = '';
  while (n > BigInt(0)) {
    out = BASE91[Number(n % radix)] + out;
    n /= radix;
  }
  return out || 'a';
}

function sanitizeDeckComponent(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/::/g, ':')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  );
}

export function deckNameForModule(courseTitle: string, index: number, moduleTitle: string): string {
  const n = String(index + 1).padStart(2, '0');
  return `${sanitizeDeckComponent(courseTitle)}::${n} · ${sanitizeDeckComponent(moduleTitle)}`;
}

// ── Note types ─────────────────────────────────────────────────────────────

const CARD_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 21px;
  line-height: 1.45;
  text-align: center;
  color: #1f2328;
  background-color: #ffffff;
  padding: 8px 4px;
}
.card.nightMode, .night_mode .card { color: #e6edf3; background-color: #1c1c1e; }
.front, .back { max-width: 640px; margin: 0 auto; }
.extra { max-width: 640px; margin: 16px auto 0; font-size: 16px; color: #57606a; }
.nightMode .extra, .night_mode .extra { color: #9da7b3; }
.source { margin-top: 20px; font-size: 12px; letter-spacing: 0.02em; color: #8c959f; }
.cloze { font-weight: 600; color: #0969da; }
.nightMode .cloze, .night_mode .cloze { color: #58a6ff; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.88em;
  padding: 1px 5px; border-radius: 5px; background: rgba(127,127,127,0.16); }
ul, ol { display: inline-block; text-align: left; margin: 6px 0; padding-left: 1.3em; }
hr#answer { margin: 16px 0; border: none; border-top: 1px solid rgba(127,127,127,0.35); }
`;

const ANSWER_TAIL =
  '{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}' +
  '{{#Source}}<div class="source">{{Source}}</div>{{/Source}}';

interface NoteTypeDef {
  id: number;
  name: string;
  type: 0 | 1; // 0 standard, 1 cloze
  fields: string[];
  templates: { name: string; qfmt: string; afmt: string }[];
  req: [number, string, number[]][];
}

const NOTE_TYPES = {
  basic: {
    id: stableId('ai-lecturer-notetype|basic|v1'),
    name: 'AI Lecturer · Basic',
    type: 0,
    fields: ['Front', 'Back', 'Extra', 'Source'],
    templates: [
      {
        name: 'Card 1',
        qfmt: '<div class="front">{{Front}}</div>',
        afmt: `{{FrontSide}}<hr id="answer"><div class="back">{{Back}}</div>${ANSWER_TAIL}`,
      },
    ],
    req: [[0, 'any', [0]]],
  },
  reverse: {
    id: stableId('ai-lecturer-notetype|reverse|v1'),
    name: 'AI Lecturer · Basic (both ways)',
    type: 0,
    fields: ['Front', 'Back', 'Extra', 'Source'],
    templates: [
      {
        name: 'Card 1',
        qfmt: '<div class="front">{{Front}}</div>',
        afmt: `{{FrontSide}}<hr id="answer"><div class="back">{{Back}}</div>${ANSWER_TAIL}`,
      },
      {
        name: 'Card 2',
        qfmt: '<div class="front">{{Back}}</div>',
        afmt: `{{FrontSide}}<hr id="answer"><div class="back">{{Front}}</div>${ANSWER_TAIL}`,
      },
    ],
    req: [
      [0, 'any', [0]],
      [1, 'any', [1]],
    ],
  },
  cloze: {
    id: stableId('ai-lecturer-notetype|cloze|v1'),
    name: 'AI Lecturer · Cloze',
    type: 1,
    fields: ['Text', 'Extra', 'Source'],
    templates: [
      {
        name: 'Cloze',
        qfmt: '<div class="front">{{cloze:Text}}</div>',
        afmt: `<div class="front">{{cloze:Text}}</div>${ANSWER_TAIL}`,
      },
    ],
    req: [[0, 'any', [0]]],
  },
} satisfies Record<string, NoteTypeDef>;

const LATEX_PRE =
  '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n' +
  '\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';

function noteTypeJson(def: NoteTypeDef, deckId: number, modSec: number) {
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    mod: modSec,
    usn: -1,
    sortf: 0,
    did: deckId,
    tmpls: def.templates.map((t, ord) => ({
      name: t.name,
      ord,
      qfmt: t.qfmt,
      afmt: t.afmt,
      bqfmt: '',
      bafmt: '',
      did: null,
    })),
    flds: def.fields.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: 'Arial',
      size: 20,
      media: [],
    })),
    css: CARD_CSS,
    latexPre: LATEX_PRE,
    latexPost: '\\end{document}',
    latexsvg: false,
    req: def.req,
    tags: [],
    vers: [],
  };
}

function deckJson(id: number, name: string, desc: string, modSec: number) {
  return {
    id,
    name,
    desc,
    mod: modSec,
    usn: -1,
    collapsed: false,
    browserCollapsed: false,
    conf: 1,
    dyn: 0,
    extendNew: 0,
    extendRev: 50,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
}

const DECK_CONF = {
  '1': {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true,
    },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
  },
};

const SCHEMA_SQL = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null, usn integer not null,
  ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
  mod integer not null, usn integer not null, tags text not null, flds text not null,
  sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
  ord integer not null, mod integer not null, usn integer not null, type integer not null,
  queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
  ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null,
  time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

let sqlPromise: Promise<SqlJsStatic> | null = null;
function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

function fieldChecksum(sortFieldHtml: string): number {
  const hex = crypto.createHash('sha1').update(stripHtml(sortFieldHtml), 'utf8').digest('hex');
  return parseInt(hex.slice(0, 8), 16);
}

function clozeOrds(text: string): number[] {
  const ords = new Set<number>();
  for (const m of text.matchAll(new RegExp(CLOZE_DELETION_RE.source, 'g'))) {
    ords.add(Number(m[1]) - 1);
  }
  return [...ords].filter((o) => o >= 0).sort((a, b) => a - b);
}

function zip(entries: { name: string; data: Buffer | string }[], date: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.pipe(sink);
    for (const e of entries) archive.append(e.data, { name: e.name, date });
    void archive.finalize();
  });
}

export interface BuildApkgResult {
  data: Buffer;
  notes: number;
  cards: number;
}

export async function buildApkg(input: BuildApkgInput): Promise<BuildApkgResult> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const modSec = Math.floor(nowMs / 1000);
  const SQL = await loadSql();
  const db = new SQL.Database();
  try {
    db.exec(SCHEMA_SQL);

    const parentName = sanitizeDeckComponent(input.courseTitle);
    const parentId = stableId(`ai-lecturer-deck|${input.courseSlug}`);
    const decks: Record<string, unknown> = {
      '1': { ...deckJson(1, 'Default', '', modSec), usn: 0 },
      [parentId]: deckJson(parentId, parentName, input.courseDescription ?? '', modSec),
    };

    const insertNote = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const insertCard = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let due = 0;
    let noteCount = 0;
    let cardCount = 0;

    input.modules.forEach((mod, moduleIndex) => {
      if (mod.cards.length === 0) return;
      const deckId = stableId(`ai-lecturer-deck|${input.courseSlug}|${mod.moduleId}`);
      decks[deckId] = deckJson(deckId, deckNameForModule(input.courseTitle, moduleIndex, mod.title), '', modSec);

      for (const card of mod.cards) {
        const guid = noteGuid(input.courseSlug, mod.moduleId, card.id);
        const noteId = stableId(`ai-lecturer-note|${guid}`);
        const source = card.lessonSlug ? (input.lessonTitles?.[card.lessonSlug] ?? '') : '';
        const extra = card.extra ? markdownToAnkiHtml(card.extra) : '';
        const sourceHtml = source ? markdownToAnkiHtml(source) : '';

        let mid: number;
        let fields: string[];
        let ords: number[];
        if (card.kind === 'cloze') {
          mid = NOTE_TYPES.cloze.id;
          fields = [markdownToAnkiHtml(card.text), extra, sourceHtml];
          ords = clozeOrds(card.text);
        } else if (card.reverse) {
          mid = NOTE_TYPES.reverse.id;
          fields = [markdownToAnkiHtml(card.front), markdownToAnkiHtml(card.back), extra, sourceHtml];
          ords = [0, 1];
        } else {
          mid = NOTE_TYPES.basic.id;
          fields = [markdownToAnkiHtml(card.front), markdownToAnkiHtml(card.back), extra, sourceHtml];
          ords = [0];
        }

        const tags = ['ai-lecturer', `ai-lecturer::${input.courseSlug}`];
        if (card.lessonSlug) tags.push(`ai-lecturer::${input.courseSlug}::${card.lessonSlug}`);

        insertNote.run([
          noteId,
          guid,
          mid,
          modSec,
          -1,
          ` ${tags.join(' ')} `,
          fields.join(FIELD_SEP),
          stripHtml(fields[0]),
          fieldChecksum(fields[0]),
          0,
          '',
        ]);
        noteCount++;
        due++;
        for (const ord of ords) {
          insertCard.run([
            stableId(`ai-lecturer-card|${guid}|${ord}`),
            noteId,
            deckId,
            ord,
            modSec,
            -1,
            0, // type: new
            0, // queue: new
            due,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            '',
          ]);
          cardCount++;
        }
      }
    });
    insertNote.free();
    insertCard.free();

    const models = Object.fromEntries(
      Object.values(NOTE_TYPES).map((def) => [String(def.id), noteTypeJson(def, parentId, modSec)]),
    );
    const conf = {
      activeDecks: [parentId],
      curDeck: parentId,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      curModel: String(NOTE_TYPES.basic.id),
      nextPos: due + 1,
      sortType: 'noteFld',
      sortBackwards: false,
      addToCur: true,
    };
    db.run('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', [
      Math.floor(nowMs / 1000 / 86400) * 86400,
      nowMs,
      nowMs,
      JSON.stringify(conf),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(DECK_CONF),
      '{}',
    ]);

    const collection = Buffer.from(db.export());
    const data = await zip(
      [
        { name: 'collection.anki2', data: collection },
        { name: 'media', data: '{}' },
      ],
      now,
    );
    return { data, notes: noteCount, cards: cardCount };
  } finally {
    db.close();
  }
}
