export interface DiffPart {
  type: 'same' | 'added' | 'removed';
  text: string;
}

function tokenize(input: string): string[] {
  if (input === '') return [];
  return input.match(/\s+|\S+/g) ?? [];
}

function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

function pushPart(
  parts: DiffPart[],
  type: DiffPart['type'],
  text: string,
): void {
  if (text === '') return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) {
    last.text += text;
  } else {
    parts.push({ type, text });
  }
}

export function diffWords(oldText: string, newText: string): DiffPart[] {
  if (oldText === '' && newText === '') return [];
  if (oldText === newText) return [{ type: 'same', text: oldText }];
  if (oldText === '') return [{ type: 'added', text: newText }];
  if (newText === '') return [{ type: 'removed', text: oldText }];

  const a = tokenize(oldText);
  const b = tokenize(newText);
  const table = lcsTable(a, b);

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  const n = a.length;
  const m = b.length;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushPart(parts, 'same', a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      pushPart(parts, 'removed', a[i]);
      i++;
    } else {
      pushPart(parts, 'added', b[j]);
      j++;
    }
  }
  while (i < n) {
    pushPart(parts, 'removed', a[i]);
    i++;
  }
  while (j < m) {
    pushPart(parts, 'added', b[j]);
    j++;
  }
  return parts;
}

export default diffWords;
