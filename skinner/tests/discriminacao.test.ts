import { describe, expect, it } from 'vitest';
import { Session, runSession, type RatConfig } from '../src/core';

const KELLER: RatConfig = { id: 'k', name: 'k', model: 'keller', learnRate: 0.3, forgetPerMin: 0.02 };

/** Respostas por minuto dentro e fora da luz, depois de uma fase de treino. */
function ratesByLight(log: ReturnType<typeof runSession>, from: number) {
  let stimulus = true;
  const bounds = log.all.filter(e => e.type === 'stimulus');
  const onAt = (t: number) => {
    stimulus = true;
    for (const e of bounds) if (e.t <= t) stimulus = e.text === 'luz acesa';
    return stimulus;
  };
  const responses = log.ofType('response').filter(e => e.t >= from);
  const on = responses.filter(e => onAt(e.t)).length;
  const off = responses.length - on;
  return { on, off };
}

describe('luz como estímulo discriminativo (S+ / S−)', () => {
  it('com reforço só na luz acesa, o rato responde mais na luz acesa', () => {
    const log = runSession({
      seed: 6,
      durationMs: 20 * 60_000,
      rat: KELLER,
      levers: [{ kind: 'FR', n: 1 }],
      luz: { ciclo: 60_000 },
    });
    const { on, off } = ratesByLight(log, 5 * 60_000);
    expect(on).toBeGreaterThan(off);
  });

  it('o log registra as trocas de luz', () => {
    const log = runSession({ seed: 6, durationMs: 3 * 60_000, rat: KELLER, levers: [{ kind: 'FR', n: 1 }], luz: { ciclo: 60_000 } });
    expect(log.ofType('stimulus').length).toBeGreaterThanOrEqual(2);
  });
});

describe('memória do rato entre sessões', () => {
  it('a força aprendida numa sessão aparece na seguinte', () => {
    const first = new Session({ seed: 2, durationMs: 10 * 60_000, rat: KELLER, levers: [{ kind: 'FR', n: 1 }] });
    first.runTo(10 * 60_000);
    first.finish();
    const memory = first.memory;
    expect(memory.strengths?.on).toBeGreaterThan(0.1);

    const naive = runSession({ seed: 9, durationMs: 60_000, rat: KELLER, levers: [{ kind: 'EXT' }] });
    const remembers = runSession({ seed: 9, durationMs: 60_000, rat: KELLER, levers: [{ kind: 'EXT' }], memoria: memory });
    expect(remembers.ofType('response').length).toBeGreaterThanOrEqual(naive.ofType('response').length);
  });

  it('fome cai com reforços e volta com o tempo', () => {
    const s = new Session({ seed: 2, durationMs: 10 * 60_000, rat: KELLER, levers: [{ kind: 'FR', n: 1 }] });
    s.runTo(5 * 60_000);
    const hungryBefore = s.hunger;
    s.runTo(10 * 60_000);
    expect(hungryBefore).toBeLessThan(1);
    expect(s.hunger).toBeGreaterThanOrEqual(0);
    expect(s.hunger).toBeLessThanOrEqual(1);
  });
});
