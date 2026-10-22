import { describe, expect, it } from 'vitest';
import { createSchedule, mulberry32, type ScheduleSpec } from '../src/core';

/** Roda um esquema sobre um padrão de respostas e devolve os instantes com reforço. */
function drive(spec: ScheduleSpec, responseAt: (t: number) => boolean, end: number, dt = 100): number[] {
  const rng = mulberry32(1);
  const schedule = createSchedule(spec);
  const out: number[] = [];
  for (let t = 0; t < end; t += dt) {
    if (schedule.step(t, responseAt(t), rng)) out.push(t);
  }
  return out;
}

describe('esquemas', () => {
  it('FR 3 reforça exatamente a cada 3 respostas', () => {
    const reinforced = drive({ kind: 'FR', n: 3 }, () => true, 3000);
    expect(reinforced).toEqual([200, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900]);
  });

  it('EXT nunca reforça', () => {
    expect(drive({ kind: 'EXT' }, () => true, 10_000)).toEqual([]);
  });

  it('FI 1 s reforça a primeira resposta depois de 1 s', () => {
    const reinforced = drive({ kind: 'FI', ms: 1000 }, () => true, 3100);
    expect(reinforced).toEqual([1000, 2000, 3000]);
  });

  it('DRO 500 ms reforça quando há 500 ms sem resposta', () => {
    const reinforced = drive({ kind: 'DRO', ms: 500 }, () => false, 1600);
    expect(reinforced).toEqual([500, 1000, 1500]);
  });

  it('DRO é adiado por respostas', () => {
    // resposta a cada 400 ms: o intervalo nunca chega a 500 ms
    const reinforced = drive({ kind: 'DRO', ms: 500 }, t => t % 400 === 0, 5000);
    expect(reinforced).toEqual([]);
  });

  it('DRL 500 ms não reforça respostas rápidas', () => {
    expect(drive({ kind: 'DRL', ms: 500 }, t => t % 100 === 0, 5000)).toEqual([]);
  });

  it('DRL 500 ms reforça respostas após pausa de pelo menos 500 ms', () => {
    expect(drive({ kind: 'DRL', ms: 500 }, t => t % 600 === 0, 2000)).toEqual([600, 1200, 1800]);
  });

  it('VI 1 s tem intervalo médio perto de 1 s', () => {
    const reinforced = drive({ kind: 'VI', ms: 1000 }, () => true, 1_000_000);
    const mean = 1_000_000 / reinforced.length;
    expect(mean).toBeGreaterThan(900);
    expect(mean).toBeLessThan(1150);
  });

  it('VR 5 reforça cerca de uma em cada 5 respostas', () => {
    const reinforced = drive({ kind: 'VR', n: 5 }, () => true, 1_000_000);
    const perResponse = reinforced.length / 10_000;
    expect(Math.abs(perResponse - 0.2)).toBeLessThan(0.02);
  });
});
