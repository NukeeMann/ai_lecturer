// The instruction prompt sent via `gemini -p`. To respect tight request-rate
// limits we polish ALL polishable fields of a lesson in ONE request: stdin
// carries a JSON array of items, the model returns a JSON array of results.

const FIELD_HINTS = {
  'lesson.title': 'tytuł lekcji',
  'lesson.eyebrow': 'krótki nagłówek nad tytułem lekcji',
  'lesson.description': 'opis (streszczenie) lekcji',
  'section.title': 'tytuł sekcji',
  'section.description': 'opis sekcji',
  'theory.markdown': 'treść teoretyczna (Markdown z matematyką KaTeX, kodem, obrazkami)',
  'quiz.question': 'treść pytania quizowego',
  'quiz.options': 'jedna z odpowiedzi w quizie',
  'quiz.explanation': 'wyjaśnienie poprawnej odpowiedzi w quizie',
  'plotImage.caption': 'podpis pod rysunkiem (zaczyna się od „Rys. N.")',
  'code.taskMarkdown': 'polecenie zadania programistycznego',
  'sandbox.encouragement': 'krótka zachęta do eksperymentowania',
  'dragMatch.prompt': 'instrukcja ćwiczenia drag-and-drop',
  'source.title': 'tytuł źródła bibliograficznego',
};

export function hintFor(ctx) {
  if (!ctx) return 'tekst';
  if (ctx.kind === 'lesson') return FIELD_HINTS[`lesson.${ctx.field}`] || 'pole lekcji';
  if (ctx.kind === 'source') return FIELD_HINTS['source.title'] || 'pole źródła';
  const key = `${ctx.type}.${ctx.field.replace('data.', '').replace('[]', '')}`;
  return FIELD_HINTS[key] || FIELD_HINTS[`section.${ctx.field}`] || `pole widgetu typu ${ctx.type}`;
}

// One prompt for the whole lesson. The fields arrive on stdin as a JSON array
// of {id, hint, text}; the model must return a JSON array of results.
export function buildBatchPrompt() {
  return `Jesteś redaktorem języka polskiego dla kursu edukacyjnego. Twoim JEDYNYM zadaniem jest POLEROWANIE JĘZYKA: poprawa składni, gramatyki, stylu i płynności tak, aby tekst był jaśniejszy i bardziej przystępny dla ucznia.

Na wejściu (stdin) dostajesz TABLICĘ JSON pól jednej lekcji. Każdy element ma:
- "id": liczba (zachowaj ją dokładnie),
- "hint": jaki to rodzaj pola (kontekst),
- "text": tekst do wypolerowania.

WAŻNE — PLACEHOLDERY ⟦N⟧: w tekstach występują znaczniki w postaci ⟦0⟧, ⟦1⟧, ⟦2⟧ … To ZAMROŻONE fragmenty (wzory matematyczne, kod, obrazki, adresy URL, numery rysunków), które zostały schowane. NIE wolno ich zmieniać, tłumaczyć, usuwać, scalać ani dodawać spacji w środku. Przepisz każdy ⟦N⟧ DOKŁADNIE w takiej formie. Każdy placeholder z wejścia musi pojawić się w "polished" dokładnie raz. Możesz przesunąć ⟦N⟧ w zdaniu tylko jeśli wymaga tego poprawna składnia, ale zwykle zostaw go w tym samym miejscu. Nie dodawaj nowych ⟦N⟧.

Dla KAŻDEGO elementu zwróć wypolerowaną wersję, stosując ŻELAZNE ZASADY:
1. NIE zmieniaj sensu, faktów, danych ani liczb widocznych w tekście. To poprawa JĘZYKOWA (składnia, styl, płynność), a nie merytoryczna.
2. Placeholdery ⟦N⟧ traktuj jak nienaruszalne — patrz wyżej.
2a. NIE dodawaj NOWEGO formatowania matematycznego ani kodu. Jeśli w tekście liczba, symbol, wzór lub nazwa jest zapisana zwykłym tekstem (np. „cos θ", „a × b", „90°", „N · L", „transform.forward", „v *= -3"), ZOSTAW ją dokładnie w tej samej formie — NIE zamieniaj jej na $...$ ani na \`kod\`. Jedyne dozwolone znaczniki matematyki/kodu to istniejące placeholdery ⟦N⟧. Nie twórz nowych $…$, $$…$$, \`…\` ani ![](…).
3. Możesz dodać NAJWYŻEJ jedno krótkie zdanie doprecyzowujące, gdy tekst jest zbyt lakoniczny — ale BEZ nowych faktów/danych. Jeśli coś dodasz, ustaw "addedContext": true dla tego pola.
4. Jeśli zauważysz błąd merytoryczny/matematyczny/logiczny — NIE poprawiaj go. Zostaw tekst bez zmian i opisz problem w "concerns".
5. Zachowaj język polski oraz strukturę Markdown (nagłówki ###, listy, pogrubienia). Wprowadzaj minimum koniecznych zmian. Jeśli pole nie wymaga zmian, ustaw "changed": false i zwróć oryginał w "polished".

POPRAWNY JSON — bardzo ważne:
- Wewnątrz tekstu używaj polskich cudzysłowów „ ” (a NIE prostego znaku ") — prosty " w środku wartości psuje JSON. Jeśli musisz użyć ", zescape'uj go jako \\".
- NIE dołączaj pól "hint" ani "text" do odpowiedzi. Zwróć tylko: id, polished, changed, addedContext, concerns.

Zwróć WYŁĄCZNIE tablicę JSON (bez komentarzy, bez bloków \`\`\`), z jednym obiektem na każdy element wejścia, w tej samej kolejności:
[{"id": <ta sama liczba>, "polished": "<tekst>", "changed": <true|false>, "addedContext": <true|false>, "concerns": [{"severity":"low|medium|high","issue":"<opis>"}]}]

Tablica pól do wypolerowania znajduje się poniżej (na stdin):
`;
}
