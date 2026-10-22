import { describe, expect, it } from 'vitest';
import { avaliar, Session, timingFeedback, type RatConfig } from '../src/core';
import { LESSONS } from '../src/content';

const SHAPING: RatConfig = { id: 'c', name: 'c', model: 'molar', repertorio: true, baseRate: 10, maxRate: 40, halfRate: 10 };

describe('repertório e modelagem', () => {
  it('um estudante que reforça aproximação e toque chega à primeira resposta', () => {
    const s = new Session({ seed: 4, durationMs: 25 * 60_000, rat: SHAPING, levers: [{ kind: 'EXT' }] });
    let t = 0;
    while (t < 25 * 60_000 && s.log.ofType('response').length === 0) {
      t += 500;
      s.runTo(t);
      const st = s.ratState!;
      const ok = (st.behavior === 'approach' && st.pos < 0.5) || st.behavior === 'touch' || st.behavior === 'press';
      const lastR = s.log.ofType('reinforcer').slice(-1)[0];
      if (ok && (!lastR || t - lastR.t > 3000)) s.act({ kind: 'deliver', lever: 0 });
    }
    expect(s.log.ofType('response').length).toBeGreaterThan(0);
  });

  it('sem reforço à mão, a pressão aparece pouco em 5 min', () => {
    const s = new Session({ seed: 4, durationMs: 5 * 60_000, rat: SHAPING, levers: [{ kind: 'EXT' }] });
    s.runTo(5 * 60_000);
    s.finish();
    expect(s.log.ofType('response').length).toBeLessThan(10);
  });

  it('timing do reforço aponta o comportamento que estava em curso', () => {
    const s = new Session({ seed: 4, durationMs: 60_000, rat: SHAPING, levers: [{ kind: 'EXT' }] });
    s.runTo(20_000);
    s.act({ kind: 'deliver', lever: 0 });
    s.runTo(60_000);
    s.finish();
    const lines = timingFeedback(s.log);
    expect(lines[0]).toMatch(/Dos seus reforços à mão/);
  });

  it('critérios de missão medem o log', () => {
    const s = new Session({ seed: 4, durationMs: 2 * 60_000, rat: { id: 'k', name: 'k', model: 'keller' }, levers: [{ kind: 'FR', n: 1 }] });
    s.runTo(2 * 60_000);
    s.finish();
    expect(avaliar(s.log, { tipo: 'reforcos', n: 1 }).ok).toBe(true);
    expect(avaliar(s.log, { tipo: 'respostas', n: 1_000_000 }).ok).toBe(false);
    expect(avaliar(s.log, { tipo: 'taxa', porMin: 1, minutos: 1 }).ok).toBe(true);
  });

  it('aulas novas carregam repertório e critério válidos', () => {
    const shaping = LESSONS.find(l => l.id === 'modelagem-barra');
    expect(shaping?.repertorio).toBe(true);
    expect(shaping?.criterio).toEqual({ tipo: 'respostas', n: 3 });
    expect(LESSONS.find(l => l.id === 'comedouro')?.criterio).toEqual({ tipo: 'reforcos', n: 5 });
  });
});
