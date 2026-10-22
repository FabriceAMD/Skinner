import { describe, expect, it } from 'vitest';
import { RATS } from '../src/content';

describe('conteúdo', () => {
  it('todo rato tem id único, modelo conhecido e visual válido', () => {
    const ids = RATS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RATS) {
      expect(['molar', 'keller']).toContain(r.model);
      expect(r.visual.pelagem).toMatch(/^#[0-9a-f]{6}$/i);
      expect([null, 'gravata', 'oculos', 'cracha']).toContain(r.visual.acessorio);
    }
  });
});
