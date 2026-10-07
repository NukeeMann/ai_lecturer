import { describe, expect, it } from 'vitest';

import { remapOptionRefs } from './explanationRefs';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// Authored order 0,1,2,3 displayed as 0,2,3,1 → authored #1=A, #3=B, #4=C, #2=D.
const ORDER = [0, 2, 3, 1];
const remap = (s: string, order: number[] = ORDER) => remapOptionRefs(s, order, LETTERS);

describe('remapOptionRefs', () => {
  it('rewrites a Polish list of option numbers to displayed letters', () => {
    expect(remap('Opcje 1, 3 i 4 są poprawne.')).toBe('Opcje A, B i C są poprawne.');
  });

  it('rewrites single references in any grammatical form', () => {
    expect(remap('więc opcja 2 jest myląca. Opcja 3 jest poprawnym wnioskiem.')).toBe(
      'więc opcja D jest myląca. Opcja B jest poprawnym wnioskiem.',
    );
    expect(remap('**Wariant 2 jest poprawny**')).toBe('**Wariant D jest poprawny**');
    expect(remap('Options 2 and 4 are traps; option 1 is right.')).toBe(
      'Options C and D are traps; option A is right.',
    );
  });

  it('keeps cited lists alphabetical after remapping', () => {
    expect(remap('Opcje 2 i 4', [3, 1, 0, 2])).toBe('Opcje A i B');
  });

  it('leaves unrelated numbers and math untouched', () => {
    const s = 'Wynik to $(0, 0, 1)$, bo $\\sin 0 = 0$. Zobacz Rys. 4 i krok 2.';
    expect(remap(s)).toBe(s);
  });

  it('leaves out-of-range references alone', () => {
    expect(remap('Opcja 5 nie istnieje, opcja 0 też nie.')).toBe('Opcja 5 nie istnieje, opcja 0 też nie.');
  });

  it('remaps "(N) —" markers only when keyword references are present', () => {
    expect(remap('Opcje 1 i 4 są poprawne. (1) — definicja. (4) — wniosek.')).toBe(
      'Opcje A i C są poprawne. (A) — definicja. (C) — wniosek.',
    );
    expect(remap('Zachodzi (1) — oraz (2): koniec.')).toBe('Zachodzi (1) — oraz (2): koniec.');
  });

  it('does not match keywords embedded in other words', () => {
    expect(remap('adopcja 2 razy')).toBe('adopcja 2 razy');
  });

  it('is a no-op for identity order', () => {
    expect(remap('Opcje 1 i 3', [0, 1, 2, 3])).toBe('Opcje A i C');
  });
});
