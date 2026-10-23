import { describe, expect, it } from 'vitest';
import { ANSIOSO, ATENTO, DISTRAIDO, play, type Persona } from './persona/player';

/**
 * Jogadores simulados: alguém de 20 e poucos anos no celular, que não lê instruções e não passa de
 * 5 minutos no jogo. Cada perfil joga 10 vezes com ratos diferentes.
 */
const CICLO_MAX = 300;

function summary(persona: Persona) {
  const runs = Array.from({ length: 10 }, (_, i) => play(i + 1, persona));
  const finished = runs.filter(r => r.finished);
  const totals = finished.map(r => r.total).sort((a, b) => a - b);
  return { finished: finished.length, median: totals[Math.floor(totals.length / 2)] ?? Infinity };
}

describe('jogador simulado completa o ciclo em menos de 5 minutos', () => {
  it.each([
    [ATENTO, 9],
    [DISTRAIDO, 9],
    [ANSIOSO, 9],
  ] as const)('perfil %#', (persona, minimo) => {
    const { finished, median } = summary(persona);
    expect(finished).toBeGreaterThanOrEqual(minimo);
    expect(median).toBeLessThan(CICLO_MAX);
  }, 120_000);
});
