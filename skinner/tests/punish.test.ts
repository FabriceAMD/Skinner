import { describe, expect, it } from 'vitest';
import { methodChecks, runSession, type RatConfig } from '../src/core';

const MOLAR: RatConfig = { id: 'm', name: 'm', model: 'molar' };
const KELLER: RatConfig = { id: 'k', name: 'k', model: 'keller' };

describe('punição', () => {
  it('registra punições só depois de respostas e só com esquema ativo', () => {
    const log = runSession({
      seed: 2,
      durationMs: 10 * 60_000,
      rat: MOLAR,
      levers: [{ kind: 'FR', n: 5 }],
      punish: [{ kind: 'FR', n: 4 }],
    });
    const punishments = log.ofType('punishment');
    expect(punishments.length).toBeGreaterThan(0);
    const responses = log.ofType('response').length;
    expect(punishments.length).toBeLessThanOrEqual(Math.ceil(responses / 4) + 1);
  });

  it('sem esquema de punição, nenhuma punição é registrada', () => {
    const log = runSession({ seed: 2, durationMs: 5 * 60_000, rat: MOLAR, levers: [{ kind: 'FR', n: 5 }] });
    expect(log.ofType('punishment')).toHaveLength(0);
  });

  it('punição reduz a taxa de resposta, no molar e no Keller', () => {
    for (const rat of [MOLAR, KELLER]) {
      const free = runSession({ seed: 9, durationMs: 20 * 60_000, rat, levers: [{ kind: 'FR', n: 2 }] });
      const punished = runSession({
        seed: 9,
        durationMs: 20 * 60_000,
        rat,
        levers: [{ kind: 'FR', n: 2 }],
        punish: [{ kind: 'FR', n: 1 }],
      });
      expect(punished.ofType('response').length).toBeLessThan(free.ofType('response').length);
    }
  });

  it('o estudante pode configurar punição durante a sessão', () => {
    const log = runSession({
      seed: 3,
      durationMs: 5 * 60_000,
      rat: MOLAR,
      levers: [{ kind: 'FR', n: 3 }],
      actions: [{ t: 60_000, kind: 'set_punish', lever: 0, spec: { kind: 'FR', n: 2 } }],
    });
    expect(log.ofType('punishment').some(e => e.t > 60_000)).toBe(true);
    expect(log.ofType('punishment').filter(e => e.t < 60_000)).toHaveLength(0);
  });
});

describe('práticas de método', () => {
  it('reconhece mudança de esquema, reforço à mão e tempo de sessão', () => {
    const log = runSession({
      seed: 4,
      durationMs: 6 * 60_000,
      rat: MOLAR,
      levers: [{ kind: 'FR', n: 3 }],
      actions: [
        { t: 30_000, kind: 'deliver', lever: 0 },
        { t: 120_000, kind: 'set_schedule', lever: 0, spec: { kind: 'VI', ms: 20_000 } },
      ],
    });
    const checks = methodChecks(log);
    expect(checks[0].ok).toBe(true);
    expect(checks[2].ok).toBe(true);
    expect(checks[3].ok).toBe(true);
  });

  it('não conta mudança de punição como mudança de esquema', () => {
    const log = runSession({
      seed: 4,
      durationMs: 6 * 60_000,
      rat: MOLAR,
      levers: [{ kind: 'FR', n: 3 }],
      actions: [{ t: 60_000, kind: 'set_punish', lever: 0, spec: { kind: 'FR', n: 2 } }],
    });
    expect(methodChecks(log)[0].ok).toBe(false);
    expect(methodChecks(log)[1].ok).toBe(true);
  });

  it('mudanças de esquema geram anotações automáticas', () => {
    const log = runSession({
      seed: 4,
      durationMs: 2 * 60_000,
      rat: MOLAR,
      levers: [{ kind: 'FR', n: 3 }],
      actions: [{ t: 60_000, kind: 'set_schedule', lever: 0, spec: { kind: 'VI', ms: 20_000 } }],
    });
    const auto = log.ofType('note').filter(e => e.auto);
    expect(auto.map(e => e.text)).toEqual(['Alavanca 1: esquema VI 20s']);
  });
});
