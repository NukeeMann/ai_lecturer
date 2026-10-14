import { describe, expect, it } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import unzipper from 'unzipper';

import { buildApkg, deckNameForModule, noteGuid, type BuildApkgInput } from './apkg';
import { markdownToAnkiHtml } from './fieldHtml';
import { FlashcardDeckSchema } from '@/lib/schemas/flashcards';

const input: BuildApkgInput = {
  courseSlug: 'geo',
  courseTitle: 'Geografia Polski',
  courseDescription: 'Powtórka',
  lessonTitles: { polozenie: 'Położenie Polski' },
  now: new Date('2026-10-14T12:00:00Z'),
  modules: [
    {
      moduleId: 'm1',
      title: 'Temat 1 – Położenie',
      cards: [
        { id: 'pow', kind: 'basic', front: 'Powierzchnia Polski?', back: '**322 716 km²**', lessonSlug: 'polozenie' },
        { id: 'izo', kind: 'basic', front: 'izoamplituda', back: 'linia jednakowej amplitudy', reverse: true },
        { id: 'zach', kind: 'cloze', text: 'Skrajny zachód: {{c1::Osinów Dolny}} ({{c2::14°07′E}}), znów {{c1::Osinów}}' },
      ],
    },
    { moduleId: 'm2', title: 'Pusty', cards: [] },
    {
      moduleId: 'm3',
      title: 'Matematyka',
      cards: [{ id: 'pit', kind: 'cloze', text: '$a^2+b^2={{c1::c^2 }}$', extra: '- $a$, $b$: przyprostokątne' }],
    },
  ],
};

async function openCollection(apkg: Buffer): Promise<Database> {
  const dir = await unzipper.Open.buffer(apkg);
  expect(dir.files.map((f) => f.path).sort()).toEqual(['collection.anki2', 'media']);
  const media = await dir.files.find((f) => f.path === 'media')!.buffer();
  expect(media.toString()).toBe('{}');
  const SQL = await initSqlJs();
  return new SQL.Database(await dir.files.find((f) => f.path === 'collection.anki2')!.buffer());
}

function rows(db: Database, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

describe('buildApkg', () => {
  it('writes one parent deck + one subdeck per non-empty module, in course order', async () => {
    const { data, notes, cards } = await buildApkg(input);
    expect(notes).toBe(4);
    // basic 1 + reverse 2 + cloze (c1, c2) 2 + cloze c1 1
    expect(cards).toBe(6);
    const db = await openCollection(data);
    const decks = JSON.parse(rows(db, 'select decks from col')[0][0] as string) as Record<string, { name: string }>;
    expect(Object.values(decks).map((d) => d.name).sort()).toEqual([
      'Default',
      'Geografia Polski',
      'Geografia Polski::01 · Temat 1 – Położenie',
      'Geografia Polski::03 · Matematyka',
    ]);
    expect(rows(db, 'select count(*) from notes')[0][0]).toBe(4);
    expect(rows(db, 'select count(*) from cards')[0][0]).toBe(6);
    // Ids are stored as SQLite integers (not REAL) — Anki relies on that.
    expect(rows(db, 'select distinct typeof(id), typeof(nid), typeof(did) from cards')).toEqual([
      ['integer', 'integer', 'integer'],
    ]);
    const clozeOrds = rows(
      db,
      "select c.ord from cards c join notes n on n.id = c.nid where n.flds like 'Skrajny%' order by c.ord",
    ).map((r) => r[0]);
    expect(clozeOrds).toEqual([0, 1]);
    db.close();
  });

  it('is deterministic: same input → same GUIDs and ids (Anki updates instead of duplicating)', async () => {
    const a = await openCollection((await buildApkg(input)).data);
    const b = await openCollection((await buildApkg({ ...input, now: new Date('2027-01-01T00:00:00Z') })).data);
    const q = 'select id, guid from notes order by id';
    expect(rows(a, q)).toEqual(rows(b, q));
    expect(rows(a, 'select id from cards order by id')).toEqual(rows(b, 'select id from cards order by id'));
    expect(rows(a, q).map((r) => r[1])).toContain(noteGuid('geo', 'm1', 'pow'));
    a.close();
    b.close();
  });

  it('stores fields as Anki HTML with the source lesson and tags', async () => {
    const db = await openCollection((await buildApkg(input)).data);
    const [flds, tags, sfld] = rows(db, "select flds, tags, sfld from notes where flds like 'Powierzchnia%'")[0] as string[];
    expect(flds.split('\x1f')).toEqual(['Powierzchnia Polski?', '<b>322 716 km²</b>', '', 'Położenie Polski']);
    expect(tags).toBe(' ai-lecturer ai-lecturer::geo ai-lecturer::geo::polozenie ');
    expect(sfld).toBe('Powierzchnia Polski?');
    const math = rows(db, "select flds from notes where flds like '%c^2%'")[0][0] as string;
    expect(math.split('\x1f')[0]).toBe('\\(a^2+b^2={{c1::c^2 }}\\)');
    db.close();
  });

  it('builds subdeck names with a sortable index and no nested "::"', () => {
    expect(deckNameForModule('Kurs', 0, 'A::B')).toBe('Kurs::01 · A:B');
    expect(deckNameForModule('Kurs', 11, 'X')).toBe('Kurs::12 · X');
  });
});

describe('markdownToAnkiHtml', () => {
  it('converts the markdown subset and escapes HTML', () => {
    expect(markdownToAnkiHtml('**a** *b* `c<d>` 1 < 2')).toBe('<b>a</b> <i>b</i> <code>c&lt;d&gt;</code> 1 &lt; 2');
    expect(markdownToAnkiHtml('Lista:\n- jeden\n- dwa\nkoniec')).toBe('Lista:<ul><li>jeden</li><li>dwa</li></ul>koniec');
    expect(markdownToAnkiHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(markdownToAnkiHtml('wzór $x_1 < y$ i $$\\sum x$$')).toBe('wzór \\(x_1 &lt; y\\) i \\[\\sum x\\]');
    expect(markdownToAnkiHtml('cena \\$5')).toBe('cena $5');
    expect(markdownToAnkiHtml('{{c1::Warszawa::miasto}}')).toBe('{{c1::Warszawa::miasto}}');
  });
});

describe('FlashcardDeckSchema', () => {
  const base = { schemaVersion: 1, courseSlug: 'geo', moduleId: 'm1' };
  it('rejects duplicate ids, cloze text without a deletion and non-slug ids', () => {
    expect(
      FlashcardDeckSchema.safeParse({
        ...base,
        cards: [
          { id: 'a', kind: 'basic', front: 'q', back: 'a' },
          { id: 'a', kind: 'basic', front: 'q2', back: 'a2' },
        ],
      }).success,
    ).toBe(false);
    expect(FlashcardDeckSchema.safeParse({ ...base, cards: [{ id: 'a', kind: 'cloze', text: 'no gap' }] }).success).toBe(false);
    expect(FlashcardDeckSchema.safeParse({ ...base, cards: [{ id: 'Card 1', kind: 'basic', front: 'q', back: 'a' }] }).success).toBe(false);
    expect(FlashcardDeckSchema.safeParse({ ...base, cards: [] }).success).toBe(false);
    expect(
      FlashcardDeckSchema.safeParse({ ...base, cards: [{ id: 'ok-1', kind: 'cloze', text: 'x {{c1::y}}' }] }).success,
    ).toBe(true);
  });
});
