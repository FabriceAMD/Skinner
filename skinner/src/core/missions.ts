import type { EventLog } from './log';
import { BEHAVIOR_LABEL, type Behavior } from './repertoire';

/** Critério de conclusão de uma missão, medido só pelo log da sessão. */
export type Criterio =
  | { tipo: 'reforcos'; n: number }
  | { tipo: 'respostas'; n: number }
  | { tipo: 'comportamento'; nome: Behavior; vezes: number }
  | { tipo: 'taxa'; porMin: number; minutos: number };

export interface Progresso {
  ok: boolean;
  texto: string;
}

/** Avalia um critério sobre o log. Mostra o progresso em texto para o estudante. */
export function avaliar(log: EventLog, c: Criterio): Progresso {
  if (c.tipo === 'reforcos') {
    const n = log.ofType('reinforcer').length;
    return { ok: n >= c.n, texto: `${Math.min(n, c.n)} de ${c.n} reforços` };
  }
  if (c.tipo === 'respostas') {
    const n = log.ofType('response').length;
    return { ok: n >= c.n, texto: `${Math.min(n, c.n)} de ${c.n} pressões registradas` };
  }
  if (c.tipo === 'comportamento') {
    const n = log.ofType('behavior').filter(e => e.text === c.nome).length;
    return {
      ok: n >= c.vezes,
      texto: `${Math.min(n, c.vezes)} de ${c.vezes} episódios de ${BEHAVIOR_LABEL[c.nome]}`,
    };
  }
  const times = log.times('response');
  const windowMs = c.minutos * 60_000;
  let best = 0;
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (j < times.length && times[j] - times[i] < windowMs) j++;
    best = Math.max(best, j - i);
  }
  const rate = best / c.minutos;
  return {
    ok: rate >= c.porMin,
    texto: `melhor ${c.minutos} min: ${rate.toFixed(1)} respostas/min (meta ${c.porMin})`,
  };
}
