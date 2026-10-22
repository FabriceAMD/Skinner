import { describe, expect, it } from 'vitest';
import { runSession, type RatConfig, type SessionConfig } from '../src/core';

const CONSTANT_RAT: RatConfig = { id: 'constante', name: 'constante', model: 'molar', baseRate: 30, maxRate: 0, noise: 0.2 };
const MOLAR: RatConfig = { id: 'molar', name: 'molar', model: 'molar' };
const KELLER: RatConfig = { id: 'keller', name: 'keller', model: 'keller' };

const base = (over: Partial<SessionConfig>): SessionConfig => ({
  seed: 1,
  durationMs: 60_000,
  rat: CONSTANT_RAT,
  levers: [{ kind: 'FR', n: 5 }],
  ...over,
});

describe('sessão', () => {
  it('mesma configuração e mesma semente geram o mesmo log', () => {
    const cfg = base({ rat: MOLAR, levers: [{ kind: 'VI', ms: 5000 }] });
    const a = JSON.stringify(runSession(cfg).all);
    const b = JSON.stringify(runSession(cfg).all);
    expect(a).toBe(b);
  });

  it('semente diferente gera log diferente', () => {
    const a = JSON.stringify(runSession(base({ rat: MOLAR, levers: [{ kind: 'VI', ms: 5000 }] })).all);
    const b = JSON.stringify(runSession(base({ seed: 2, rat: MOLAR, levers: [{ kind: 'VI', ms: 5000 }] })).all);
    expect(a).not.toBe(b);
  });

  it('ação do estudante troca o esquema e reforços param após EXT', () => {
    const log = runSession(
      base({
        durationMs: 120_000,
        levers: [{ kind: 'FR', n: 2 }],
        actions: [{ t: 60_000, kind: 'set_schedule', lever: 0, spec: { kind: 'EXT' } }],
      }),
    );
    const after = log.ofType('reinforcer').filter(e => e.t > 60_000);
    expect(after).toHaveLength(0);
    expect(log.ofType('schedule_set', 0).map(e => e.spec)).toEqual(['FR 2', 'EXT']);
  });

  it('reforço entregue à mão fica registrado como manual', () => {
    const log = runSession(base({ actions: [{ t: 5000, kind: 'deliver', lever: 0 }] }));
    const manual = log.ofType('reinforcer').filter(e => e.source === 'manual');
    expect(manual.map(e => e.t)).toEqual([5000]);
  });

  it('o rato molar responde mais quando o reforço é mais frequente', () => {
    const rich = runSession(base({ rat: MOLAR, durationMs: 600_000, levers: [{ kind: 'VI', ms: 2000 }] }));
    const lean = runSession(base({ rat: MOLAR, durationMs: 600_000, levers: [{ kind: 'VI', ms: 60_000 }] }));
    expect(rich.ofType('response').length).toBeGreaterThan(lean.ofType('response').length * 1.5);
  });

  it('lei da igualação: com VI 30 s e VI 90 s, o rato aloca cerca de 75% das respostas à alavanca mais rica', () => {
    const log = runSession(
      base({
        rat: MOLAR,
        durationMs: 30 * 60_000,
        levers: [{ kind: 'VI', ms: 30_000 }, { kind: 'VI', ms: 90_000 }],
      }),
    );
    const rich = log.ofType('response', 0).length;
    const total = log.ofType('response').length;
    const share = rich / total;
    // com 20% de exploração, a alocação estável fica perto de 0,7 (igualação com exploração)
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.85);
  });

  it('Keller: o estudante avança de estágio quando o rato atinge o critério', () => {
    const log = runSession(
      base({
        rat: KELLER,
        durationMs: 10 * 60_000,
        levers: [{ kind: 'FR', n: 1 }],
        curriculum: [
          { spec: { kind: 'FR', n: 1 }, minReinforcers: 5 },
          { spec: { kind: 'FR', n: 3 }, minReinforcers: 5 },
        ],
      }),
    );
    const stages = log.ofType('stage_change').map(e => e.spec);
    expect(stages).toEqual(['FR 3']);
  });
});
