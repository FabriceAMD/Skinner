import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core';

describe('mulberry32', () => {
  it('gera a mesma sequência para a mesma semente', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('gera valores em [0, 1) com média perto de 0,5', () => {
    const rng = mulberry32(7);
    const xs = Array.from({ length: 20_000 }, () => rng());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
  });
});
