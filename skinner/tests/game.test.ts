import { describe, expect, it } from 'vitest';
import type { ScheduleSpec } from '../src/core/schedules';
import { BAR_X, Sim } from '../src/game/sim';

const run = (sim: Sim, seconds: number) => {
  const end = sim.t + seconds;
  while (sim.t < end) sim.step(0.05);
};

/** Estudante simulado: treino de comedouro e depois modelagem com critério que sobe aos poucos. */
function trainAndShape(sim: Sim, limit = 1200): { tMag: number; tShape: number } {
  let last = -99;
  let clicks = 0;
  let next = 0;
  let tMag = -1;
  while (sim.t < limit) {
    sim.step(0.05);
    if (sim.t < next) continue;
    next = sim.t + 0.2;
    if (tMag < 0) {
      if (sim.vMag >= 0.6) tMag = sim.t;
      else if (sim.t - last > 4 && sim.behavior !== 'comer' && sim.pellets === 0) {
        sim.click();
        last = sim.t;
      }
      continue;
    }
    if (sim.pressesSince(60) >= 5) return { tMag, tShape: sim.t - tMag };
    const b = sim.behavior;
    const chain = ['aproximar', 'cheirarBarra', 'apoiar', 'pressionar'];
    const stage = Math.min(4, Math.floor(clicks / 5));
    const ok =
      stage === 0
        ? chain.includes(b)
        : stage === 1
          ? chain.includes(b) && sim.x > BAR_X - 0.3
          : stage === 2
            ? chain.slice(1).includes(b)
            : stage === 3
              ? chain.slice(2).includes(b)
              : sim.pressesSince(0.3) > 0;
    if (ok && sim.t - last > 1.2 && sim.pellets === 0) {
      sim.click();
      last = sim.t;
      clicks++;
    }
  }
  return { tMag, tShape: -1 };
}

describe('simulação do rato', () => {
  it('mesma semente, mesmos eventos', () => {
    const a = new Sim(3);
    const b = new Sim(3);
    run(a, 120);
    run(b, 120);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.behavior).toBe(b.behavior);
  });

  it('antes do treino, o clique quase não reforça; depois, vira reforçador condicionado', () => {
    const sim = new Sim(1);
    expect(sim.click().quality).toBe('sem-efeito');
    const { tMag } = trainAndShape(sim, 400);
    expect(tMag).toBeGreaterThan(0);
    expect(sim.vMag).toBeGreaterThan(0.5);
  });

  it.each([1, 2, 3, 4, 5])('modelagem progressiva chega a 5 pressões por minuto (semente %i)', seed => {
    const sim = new Sim(seed);
    const { tShape } = trainAndShape(sim);
    expect(tShape).toBeGreaterThan(0);
    expect(tShape).toBeLessThan(600);
  });

  it('razão fixa produz taxa maior que reforço contínuo; extinção tem surto e depois queda', () => {
    const trained = new Sim(2);
    trainAndShape(trained);
    // cada esquema é medido num rato com fome, como no laboratório: cópias do mesmo rato modelado
    const rateUnder = (spec: ScheduleSpec): Sim => {
      const sim = new Sim(20, trained.snapshot());
      sim.setSchedule(spec);
      run(sim, 120);
      return sim;
    };
    const crf = rateUnder({ kind: 'FR', n: 1 }).pressesSince(60);
    const fr = rateUnder({ kind: 'FR', n: 5 });
    const fr5 = fr.pressesSince(60);
    fr.setSchedule(null);
    run(fr, 60);
    const firstMinute = fr.pressesSince(60);
    run(fr, 180);
    const thirdMinute = fr.pressesSince(60);
    // razão fixa: responder mais rápido rende mais reforço, então a taxa passa a do reforço contínuo
    expect(fr5).toBeGreaterThan(crf);
    expect(firstMinute).toBeGreaterThan(10);
    expect(thirdMinute).toBeLessThan(firstMinute / 2);
  });

  it('com reforço só na luz acesa, o rato passa a pressionar mais com luz', () => {
    let on = 0;
    let off = 0;
    for (const seed of [1, 2, 3]) {
      const sim = new Sim(seed);
      trainAndShape(sim);
      sim.setSchedule({ kind: 'VI', ms: 5000 });
      run(sim, 60);
      sim.setLightCycle(20);
      run(sim, 600);
      const counts = sim.pressesByLight(sim.t - 180);
      on += counts.on;
      off += counts.off;
    }
    expect(on).toBeGreaterThan(off * 1.5);
  });

  it('saciedade: pelotas reduzem a fome e o valor do reforço', () => {
    const sim = new Sim(1);
    trainAndShape(sim);
    sim.setSchedule({ kind: 'FR', n: 1 });
    run(sim, 120);
    expect(sim.hunger).toBeLessThan(1);
  });
});
