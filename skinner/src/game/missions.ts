import type { Behavior, Sim } from './sim';
import type { ScheduleSpec } from '../core/schedules';

export interface Progress {
  value: number;
  goal: number;
}

/** Uma etapa de modelagem: os comportamentos que valem reforço agora. */
export interface Etapa {
  icone: string;
  alvos: Behavior[];
  /** Também vale qualquer comportamento com o rato a partir desta posição (0 a 1) da caixa. */
  zona?: number;
}

export interface Mission {
  id: string;
  /** Ícone que identifica a missão sem precisar ler. */
  icone: string;
  titulo: string;
  /** Uma frase, para quem quiser ler, mostrada ao concluir. */
  licao: string;
  cliqueManual: boolean;
  esquema: ScheduleSpec | null;
  luz: number | null;
  /** Segundos de rato por segundo real. Fases automáticas correm rápido. */
  velocidade: number;
  /** Modelagem: o critério sobe sozinho a cada 3 acertos. */
  etapas?: Etapa[];
  alvos: Behavior[];
  /** Quando o botão acende: rato pronto para o clique ou fazendo o comportamento-alvo. */
  deixa: 'pronto' | 'alvo' | null;
  /** Segundos reais para 3 e 2 estrelas. */
  estrelas: [number, number];
  progresso(sim: Sim, inicio: number): Progress;
}

const pressesSince = (sim: Sim, from: number): number => sim.events.filter(e => e.kind === 'press' && e.t >= from).length;

export const MISSIONS: Mission[] = [
  {
    id: 'clique',
    icone: '🔔',
    titulo: 'Clique = comida',
    licao: 'O clique virou reforçador condicionado: agora ele reforça na hora, sem esperar a comida.',
    cliqueManual: true,
    esquema: null,
    luz: null,
    velocidade: 1.5,
    alvos: [],
    deixa: 'pronto',
    estrelas: [30, 60],
    // termina quando ele corre ao comedouro ao ouvir o clique e o clique já vale como reforço
    progresso: sim => ({ value: Math.min(sim.orientStreak, 4) * (sim.vMag >= 0.6 ? 1 : 0.75), goal: 4 }),
  },
  {
    id: 'modelagem',
    icone: '🎯',
    titulo: 'Modelagem',
    licao: 'Você modelou por aproximações sucessivas: reforçou passos cada vez mais perto da pressão na barra.',
    cliqueManual: true,
    esquema: null,
    luz: null,
    velocidade: 2,
    etapas: [
      { icone: '➡️', alvos: ['aproximar', 'cheirarBarra', 'apoiar', 'pressionar'], zona: 0.55 },
      { icone: '👃', alvos: ['cheirarBarra', 'apoiar', 'pressionar'] },
      { icone: '🐾', alvos: ['apoiar', 'pressionar'] },
      { icone: '⬇️', alvos: ['pressionar'] },
    ],
    alvos: [],
    deixa: 'alvo',
    estrelas: [75, 120],
    // termina quando o estudante reforça 3 pressões na hora certa ou quando o rato já pressiona 3 vezes por minuto
    progresso: (sim, inicio) => {
      const reforcadas = sim.reports.filter(r => r.t >= inicio && r.reinforced === 'pressionar' && r.points > 0).length;
      const porMinuto = sim.events.filter(e => e.kind === 'press' && e.t >= Math.max(inicio, sim.t - 60)).length;
      return { value: Math.min(Math.max(reforcadas, porMinuto), 3), goal: 3 };
    },
  },
  {
    id: 'continuo',
    icone: '⚙️',
    titulo: 'Reforço contínuo',
    licao: 'Em reforço contínuo (CRF), cada resposta é reforçada.',
    cliqueManual: false,
    esquema: { kind: 'FR', n: 1 },
    luz: null,
    velocidade: 8,
    alvos: [],
    deixa: null,
    estrelas: [Infinity, Infinity],
    progresso: (sim, inicio) => ({ value: Math.min(pressesSince(sim, inicio), 10), goal: 10 }),
  },
  {
    id: 'razao',
    icone: '🔁',
    titulo: 'Razão fixa 5',
    licao: 'Em razão fixa, quanto mais rápido ele responde, mais reforço ganha. A taxa sobe.',
    cliqueManual: false,
    esquema: { kind: 'FR', n: 5 },
    luz: null,
    velocidade: 8,
    alvos: [],
    deixa: null,
    estrelas: [Infinity, Infinity],
    progresso: (sim, inicio) => ({ value: Math.min(pressesSince(sim, inicio), 30), goal: 30 }),
  },
  {
    id: 'extincao',
    icone: '🚫',
    titulo: 'Extinção',
    licao: 'Sem reforço, o comportamento cai, mas primeiro vem o surto de extinção.',
    cliqueManual: false,
    esquema: null,
    luz: null,
    velocidade: 8,
    alvos: [],
    deixa: null,
    estrelas: [Infinity, Infinity],
    progresso: (sim, inicio) => ({ value: Math.min(sim.t - inicio, 120), goal: 120 }),
  },
  {
    id: 'luz',
    icone: '💡',
    titulo: 'Luz que manda',
    licao: 'A luz virou estímulo discriminativo: ele pressiona mais quando ela está acesa.',
    cliqueManual: false,
    esquema: { kind: 'VI', ms: 5000 },
    luz: 20,
    velocidade: 10,
    alvos: [],
    deixa: null,
    estrelas: [Infinity, Infinity],
    progresso: (sim, inicio) => {
      // só conta pressões desta fase, depois de 1 min para o rato começar a discriminar
      if (sim.t - inicio < 120) return { value: ((sim.t - inicio) / 120) * 0.5, goal: 1 };
      const { on, off } = sim.pressesByLight(Math.max(inicio + 60, sim.t - 120));
      const ok = on >= 10 && on >= 2 * off;
      return { value: ok ? 1 : Math.min(0.95, (off === 0 ? on : on / off) / 2), goal: 1 };
    },
  },
];

/** Laboratório livre: sem meta, clique liberado, alimentador e luz configuráveis na tela. */
export const LIVRE: Mission = {
  id: 'livre',
  icone: '🧪',
  titulo: 'Laboratório livre',
  licao: '',
  cliqueManual: true,
  esquema: null,
  luz: null,
  velocidade: 1,
  alvos: [],
  deixa: null,
  estrelas: [Infinity, Infinity],
  progresso: () => ({ value: 0, goal: 1 }),
};
