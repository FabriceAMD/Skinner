import { describe, expect, it } from 'vitest';
import { LESSONS, RATS, findRat } from '../src/content';
import { runSession } from '../src/core';

describe('conteúdo', () => {
  it('todo rato tem id único e modelo conhecido', () => {
    const ids = RATS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RATS.every(r => r.model === 'molar' || r.model === 'keller')).toBe(true);
  });

  it('toda aula aponta para um rato existente e tem esquemas válidos', () => {
    for (const lesson of LESSONS) {
      expect(() => findRat(lesson.rato)).not.toThrow();
      expect(lesson.alavancas.length).toBeGreaterThan(0);
      expect(lesson.perguntas.length).toBeGreaterThan(0);
    }
  });

  it('toda aula roda como sessão completa', () => {
    for (const lesson of LESSONS) {
      const log = runSession({
        seed: 5,
        durationMs: 2 * 60_000,
        rat: findRat(lesson.rato),
        levers: lesson.alavancas,
        curriculum: lesson.curriculo,
      });
      expect(log.ofType('response').length).toBeGreaterThan(0);
    }
  });
});
