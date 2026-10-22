import { mulberry32 } from '../../src/core/rng';
import { Flow } from '../../src/game/flow';
import { MISSIONS } from '../../src/game/missions';
import { Sim } from '../../src/game/sim';

/**
 * Jogador simulado: alguém de 20 e poucos anos no celular, que não lê instruções.
 * Ele olha a caixa e o botão; quando o botão acende, toca depois do tempo de reação.
 * Às vezes perde a deixa, às vezes toca por tédio. Desiste se uma fase passar de `giveUp` segundos.
 */
export interface Persona {
  name: string;
  reactMs: number;
  reactSdMs: number;
  /** Chance de perceber que o botão acendeu. */
  attention: number;
  /** Toques aleatórios por segundo (tédio, ansiedade). */
  randomTapsPerSec: number;
  giveUp: number;
}

export const ATENTO: Persona = { name: 'atento', reactMs: 450, reactSdMs: 120, attention: 0.9, randomTapsPerSec: 0.05, giveUp: 180 };
export const DISTRAIDO: Persona = { name: 'distraído', reactMs: 700, reactSdMs: 250, attention: 0.5, randomTapsPerSec: 0.1, giveUp: 180 };
export const ANSIOSO: Persona = { name: 'ansioso', reactMs: 300, reactSdMs: 80, attention: 0.9, randomTapsPerSec: 2, giveUp: 180 };

export interface Run {
  perMission: number[];
  total: number;
  finished: boolean;
  stuckAt: string | null;
  stars: number[];
  /** Onde parou, se travou: etapa de modelagem e valor do clique. */
  detail?: string;
}

/** Tempo olhando a tela de conclusão antes da próxima fase. */
const CELEBRATION = 2.5;
const FRAME = 1 / 30;

export function play(seed: number, persona: Persona): Run {
  const rng = mulberry32(seed * 7919 + 13);
  const gauss = (): number => {
    const u = Math.max(1e-9, rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
  const sim = new Sim(seed);
  const perMission: number[] = [];
  const stars: number[] = [];
  let total = 0;

  for (let i = 0; i < MISSIONS.length; i++) {
    const flow = new Flow(i, sim);
    let t = 0;
    let wasCue = false;
    let tapAt: number | null = null;
    let randomRate = persona.randomTapsPerSec;
    /** Toque com reação ao que aparece na tela: aviso negativo faz a pessoa tocar menos à toa. */
    const tap = (): void => {
      const report = flow.click();
      if (report && (report.quality === 'sem-efeito' || (flow.targets.length > 0 && report.points === 0))) {
        randomRate = Math.max(0.1, randomRate * 0.8);
      }
    };
    while (!flow.result && t < persona.giveUp) {
      flow.advance(FRAME);
      t += FRAME;
      const cue = flow.cue();
      // deixa forte (pulso grande + vibração) chama mais a atenção
      const attention = flow.strongCue ? Math.min(0.95, persona.attention + 0.3) : persona.attention;
      if (cue && !wasCue && tapAt === null && rng() < attention) {
        tapAt = t + Math.max(0.2, (persona.reactMs + gauss() * persona.reactSdMs) / 1000);
      }
      wasCue = cue;
      if (tapAt !== null && t >= tapAt) {
        tap();
        tapAt = null;
      }
      if (rng() < randomRate * FRAME) tap();
    }
    perMission.push(t);
    total += t;
    if (!flow.result) {
      const detail = `etapa ${flow.stepIndex} vMag ${sim.vMag.toFixed(2)} pressões/min ${sim.pressesSince(60)} reforços ${sim.reports.length}`;
      return { perMission, total, finished: false, stuckAt: MISSIONS[i].id, stars, detail };
    }
    stars.push(flow.result.stars);
    total += CELEBRATION;
  }
  return { perMission, total, finished: true, stuckAt: null, stars };
}
