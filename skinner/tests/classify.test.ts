import { describe, expect, it } from 'vitest';
import {
  classify,
  compareIntent,
  describeSession,
  inputFromLog,
  runSession,
  type RatConfig,
  type ScheduleSpec,
} from '../src/core';

/** Rato com taxa constante de 30 respostas/min: deixa o teste previsível sem perder variação. */
const RAT: RatConfig = { id: 'teste', name: 'teste', model: 'molar', baseRate: 30, maxRate: 0, noise: 0.2 };
const MINUTES = 60;

function classifySchedule(spec: ScheduleSpec, seed = 3) {
  const log = runSession({ seed, durationMs: MINUTES * 60_000, rat: RAT, levers: [spec] });
  return classify(inputFromLog(log, 0));
}

describe('classificador: logs com contingência conhecida', () => {
  it('FR 10 construído à mão é reconhecido', () => {
    const responses = Array.from({ length: 200 }, (_, i) => (i + 1) * 100);
    const reinforcers = responses.filter((_, i) => (i + 1) % 10 === 0);
    const result = classify({ responses, reinforcers });
    expect(result.label).toBe('FR');
    expect(result.spec).toEqual({ kind: 'FR', n: 10 });
  });

  it('EXT é reconhecido quando não há reforço', () => {
    expect(classifySchedule({ kind: 'EXT' }).label).toBe('EXT');
  });

  it('FR 5 é reconhecido com n = 5', () => {
    const r = classifySchedule({ kind: 'FR', n: 5 });
    expect(r.label).toBe('FR');
    expect(r.spec).toEqual({ kind: 'FR', n: 5 });
  });

  it('VR 5 cai no grupo variável (não separável só pelo registro)', () => {
    expect(classifySchedule({ kind: 'VR', n: 5 }).label).toBe('VARIAVEL');
  });

  it('FI 10 s é reconhecido como FI, com ms perto de 10 s', () => {
    const r = classifySchedule({ kind: 'FI', ms: 10_000 });
    expect(r.label).toBe('FI');
    expect(Math.abs((r.spec as { ms: number }).ms - 10_000)).toBeLessThan(2500);
  });

  it('VI 20 s cai no grupo variável, e o caderno aceita VI ou VR como compatível', () => {
    const r = classifySchedule({ kind: 'VI', ms: 20_000 });
    expect(r.label).toBe('VARIAVEL');
    expect(compareIntent({ kind: 'VI', ms: 20_000 }, r).match).toBe(true);
  });

  it('DRO 5 s é reconhecido: reforços chegam após silêncio regular', () => {
    const r = classifySchedule({ kind: 'DRO', ms: 5000 });
    expect(r.label).toBe('DRO');
    expect(Math.abs((r.spec as { ms: number }).ms - 5000)).toBeLessThan(1000);
  });

  it('DRL 2 s é reconhecido: respostas reforçadas vêm após pausa', () => {
    const r = classifySchedule({ kind: 'DRL', ms: 2000 });
    expect(r.label).toBe('DRL');
    expect(Math.abs((r.spec as { ms: number }).ms - 2000) / 2000).toBeLessThan(0.25);
  });
});

describe('caderno de laboratório', () => {
  it('declarar FR 5 e implementar FR 5 coincide', () => {
    const result = classify({
      responses: Array.from({ length: 50 }, (_, i) => (i + 1) * 100),
      reinforcers: Array.from({ length: 10 }, (_, i) => (i + 1) * 500),
    });
    expect(compareIntent({ kind: 'FR', n: 5 }, result).match).toBe(true);
    expect(compareIntent({ kind: 'FR', n: 10 }, result).match).toBe(false);
  });
});

describe('feedback descritivo', () => {
  it('descreve mudanças e entregas manuais sem elogio', () => {
    const log = runSession({
      seed: 4,
      durationMs: 5 * 60_000,
      rat: RAT,
      levers: [{ kind: 'FR', n: 5 }],
      actions: [
        { t: 60_000, kind: 'set_schedule', lever: 0, spec: { kind: 'VR', n: 10 } },
        { t: 120_000, kind: 'deliver', lever: 0 },
      ],
    });
    const text = describeSession(log, 5 * 60_000).join(' ');
    expect(text).toContain('Você mudou o esquema 1 vez');
    expect(text).toContain('Você entregou 1 de');
    expect(text).not.toMatch(/parab|ótimo|muito bem|excelente/i);
  });
});
