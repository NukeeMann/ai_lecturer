import { describe, expect, it } from 'vitest';

import {
  angularDistanceDeg,
  cartesianToSpherical,
  ELECTRODES_10_20,
  electrodePosition,
  electrodeSide,
  electrodeKind,
  isScalpElectrode,
  nearestElectrode,
  normalizeElectrode,
  parseChannelLabel,
  POSITIONED_ELECTRODES,
  projectElectrode,
  projectSpherical,
  sphericalToCartesian,
  unprojectToSpherical,
} from './electrodes';

const pos = (e: string) => {
  const p = electrodePosition(e);
  if (!p) throw new Error(`no position for ${e}`);
  return p;
};

describe('normalizeElectrode', () => {
  it.each([
    ['Fp1', 'Fp1'],
    ['FP1', 'Fp1'],
    [' fp2 ', 'Fp2'],
    ['CZ', 'Cz'],
    ['T3', 'T7'],
    ['T4', 'T8'],
    ['T5', 'P7'],
    ['T6', 'P8'],
    ['EEG Fp1-REF', 'Fp1'],
    ['EEG T3-Ref', 'T7'],
    ['Cz-LE', 'Cz'],
    ['O1-AVG', 'O1'],
    ['POL C3', 'C3'],
    ['M1', 'A1'],
    ['a2', 'A2'],
    ['EKG', 'ECG'],
    ['ECG1', 'ECG'],
    ['T10', 'T10'],
    ['fpz', 'Fpz'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeElectrode(raw)).toBe(expected);
  });

  it.each(['Fp1-F7', 'XYZ', '', '   ', 'Fp3', 'EEG'])('rejects %j', (raw) => {
    expect(normalizeElectrode(raw)).toBeNull();
  });
});

describe('parseChannelLabel', () => {
  it('parses single electrodes and derivations to canonical form', () => {
    expect(parseChannelLabel('EEG FP1-REF')).toEqual({ kind: 'electrode', electrode: 'Fp1', label: 'Fp1' });
    expect(parseChannelLabel('EEG FP1-F7')).toEqual({ kind: 'derivation', plus: 'Fp1', minus: 'F7', label: 'Fp1-F7' });
    expect(parseChannelLabel('T3 - T5')).toEqual({ kind: 'derivation', plus: 'T7', minus: 'P7', label: 'T7-P7' });
    expect(parseChannelLabel('Fp1-A1')).toMatchObject({ kind: 'derivation', minus: 'A1' });
  });

  it('rejects unknown or degenerate labels', () => {
    expect(parseChannelLabel('Fp1-Fp1')).toBeNull();
    expect(parseChannelLabel('Fp1-F7-T7')).toBeNull();
    expect(parseChannelLabel('foo-bar')).toBeNull();
  });
});

describe('electrode classification', () => {
  it('classifies kinds and sides', () => {
    expect(electrodeKind('Fp1')).toBe('scalp');
    expect(electrodeKind('T9')).toBe('scalp');
    expect(electrodeKind('A1')).toBe('ear');
    expect(electrodeKind('ECG')).toBe('nonScalp');
    expect(electrodeKind('nope')).toBeNull();
    expect(isScalpElectrode('A2')).toBe(false);
    expect(electrodeSide('Fp1')).toBe('left');
    expect(electrodeSide('F8')).toBe('right');
    expect(electrodeSide('Cz')).toBe('midline');
    expect(electrodeSide('Fpz')).toBe('midline');
    expect(electrodeSide('A1')).toBe('left');
    expect(electrodeSide('T10')).toBe('right');
    expect(electrodeSide('ECG')).toBeNull();
  });
});

describe('head geometry', () => {
  it('places every 10-20 electrode on the unit sphere', () => {
    for (const e of ELECTRODES_10_20) {
      const [x, y, z] = pos(e);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    }
    expect(POSITIONED_ELECTRODES).toEqual(expect.arrayContaining(['A1', 'A2', 'F9', 'T10', 'T1', 'Oz']));
  });

  it('follows the 10-20 spacing on the idealised sphere', () => {
    expect(pos('Cz')[2]).toBeCloseTo(1, 9);
    expect(angularDistanceDeg(pos('Fp1'), pos('F7'))).toBeCloseTo(36, 6);
    expect(angularDistanceDeg(pos('T7'), pos('Cz'))).toBeCloseTo(90, 6);
    expect(angularDistanceDeg(pos('T7'), pos('C3'))).toBeCloseTo(45, 6);
    expect(angularDistanceDeg(pos('C3'), pos('Cz'))).toBeCloseTo(45, 6);
    expect(angularDistanceDeg(pos('Fz'), pos('Cz'))).toBeCloseTo(45, 6);
    // F3 is the midpoint of the F7–Fz arc.
    expect(angularDistanceDeg(pos('F3'), pos('F7'))).toBeCloseTo(angularDistanceDeg(pos('F3'), pos('Fz')), 6);
  });

  it('is left/right mirror symmetric', () => {
    const pairs: [string, string][] = [['Fp1', 'Fp2'], ['F3', 'F4'], ['F7', 'F8'], ['T7', 'T8'], ['P3', 'P4'], ['O1', 'O2'], ['A1', 'A2']];
    for (const [l, r] of pairs) {
      const a = pos(l);
      const b = pos(r);
      expect(a[0]).toBeLessThan(0); // left hemisphere has x < 0
      expect(a[0]).toBeCloseTo(-b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
      expect(a[2]).toBeCloseTo(b[2], 9);
    }
  });

  it('round-trips spherical ↔ cartesian', () => {
    const p = { theta: 63, phi: -37 };
    const back = cartesianToSpherical(sphericalToCartesian(p));
    expect(back.theta).toBeCloseTo(63, 9);
    expect(back.phi).toBeCloseTo(-37, 9);
  });

  it('finds the nearest electrode', () => {
    expect(nearestElectrode({ theta: 90, phi: 55 })).toBe('F8');
    expect(nearestElectrode({ theta: 2, phi: 0 })).toBe('Cz');
    expect(nearestElectrode({ theta: 90, phi: -88 }, ['T7', 'C3'])).toBe('T7');
  });
});

describe('2-D head projection (top view, nose up, left on the left)', () => {
  it('puts the nose up, the left hemisphere left and the equator on the unit circle', () => {
    const fpz = projectElectrode('Fpz')!;
    expect(fpz.x).toBeCloseTo(0, 9);
    expect(fpz.y).toBeCloseTo(-1, 9); // anterior = up (negative SVG y)
    const oz = projectElectrode('Oz')!;
    expect(oz.y).toBeCloseTo(1, 9);
    const t7 = projectElectrode('T7')!;
    expect(t7.x).toBeCloseTo(-1, 9);
    expect(t7.y).toBeCloseTo(0, 9);
    expect(projectElectrode('C4')!.x).toBeGreaterThan(0);
    const cz = projectElectrode('Cz')!;
    expect(Math.hypot(cz.x, cz.y)).toBeCloseTo(0, 9);
    // Inferior row falls outside the head circle.
    const t9 = projectElectrode('T9')!;
    expect(Math.hypot(t9.x, t9.y)).toBeGreaterThan(1);
  });

  it('unprojects back to the same spherical point', () => {
    const p = { theta: 72, phi: 120 };
    const q = unprojectToSpherical(projectSpherical(p));
    expect(q.theta).toBeCloseTo(72, 9);
    expect(q.phi).toBeCloseTo(120, 9);
    expect(unprojectToSpherical({ x: 5, y: 0 }).theta).toBe(130); // clamped
  });
});
