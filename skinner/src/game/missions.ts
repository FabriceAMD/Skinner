import type { Behavior, Sim } from './sim';
import type { ScheduleSpec } from '../core/schedules';

export interface Progress {
  value: number;
  goal: number;
  text: string;
}

export interface Mission {
  id: string;
  titulo: string;
  resumo: string;
  /** Dicas curtas, mostradas uma de cada vez durante a missão. */
  dicas: string[];
  /** Comportamentos que valem ponto quando reforçados com bom timing. */
  alvos: Behavior[];
  /** O estudante pode clicar? Nas missões automáticas, quem reforça é o alimentador. */
  cliqueManual: boolean;
  esquema: ScheduleSpec | null;
  luz: number | null;
  /** Segundos de rato para 3 e 2 estrelas. */
  estrelas: [number, number];
  progresso(sim: Sim, inicio: number): Progress;
  /** Uma frase sobre o que aconteceu, mostrada ao concluir. */
  licao: string;
}

const pressesSince = (sim: Sim, from: number): number => sim.events.filter(e => e.kind === 'press' && e.t >= from).length;

export const MISSIONS: Mission[] = [
  {
    id: 'clique',
    titulo: 'Carregar o clique',
    resumo: 'Ensine que o clique anuncia comida.',
    dicas: [
      'Clique quando ele não estiver comendo.',
      'Espere ele comer antes do próximo clique.',
      'Quando ele correr para o comedouro ao ouvir o clique, o clique virou reforço.',
    ],
    alvos: [],
    cliqueManual: true,
    esquema: null,
    luz: null,
    estrelas: [60, 150],
    progresso: sim => ({
      value: Math.min(sim.orientStreak, 5),
      goal: 5,
      text: `${Math.min(sim.orientStreak, 5)} de 5 corridas seguidas ao comedouro depois do clique`,
    }),
    licao: 'O clique virou reforçador condicionado: agora ele reforça na hora, sem esperar a comida.',
  },
  {
    id: 'modelagem',
    titulo: 'Modelagem até a barra',
    resumo: 'Reforce aproximações até ele pressionar a barra.',
    dicas: [
      'Comece clicando quando ele for em direção à barra.',
      'Depois, só quando cheirar ou apoiar na barra.',
      'No fim, só quando a barra descer.',
      'Clique na hora: o que ele faz no instante do clique é o que fica.',
    ],
    alvos: ['aproximar', 'cheirarBarra', 'apoiar', 'pressionar'],
    cliqueManual: true,
    esquema: null,
    luz: null,
    estrelas: [150, 300],
    progresso: sim => {
      const n = Math.min(sim.pressesSince(60), 5);
      return { value: n, goal: 5, text: `${n} de 5 pressões no último minuto` };
    },
    licao: 'Você modelou por aproximações sucessivas: reforçou passos cada vez mais perto da resposta-alvo.',
  },
  {
    id: 'continuo',
    titulo: 'Reforço contínuo',
    resumo: 'Agora o alimentador reforça cada pressão sozinho.',
    dicas: ['Só observe. Cada pressão gera clique e pelota.', 'Veja a curva subir no registro.'],
    alvos: [],
    cliqueManual: false,
    esquema: { kind: 'FR', n: 1 },
    luz: null,
    estrelas: [90, 180],
    progresso: (sim, inicio) => {
      const n = Math.min(pressesSince(sim, inicio), 30);
      return { value: n, goal: 30, text: `${n} de 30 pressões` };
    },
    licao: 'Em reforço contínuo (CRF), cada resposta é reforçada. O comportamento se mantém, mas o rato também se sacia rápido.',
  },
  {
    id: 'razao',
    titulo: 'Razão fixa 5',
    resumo: 'Reforço a cada 5 pressões. Veja a taxa subir.',
    dicas: ['Compare a inclinação do registro com a do reforço contínuo.', 'Razão alta, taxa alta.'],
    alvos: [],
    cliqueManual: false,
    esquema: { kind: 'FR', n: 5 },
    luz: null,
    estrelas: [120, 240],
    progresso: (sim, inicio) => {
      const n = Math.min(pressesSince(sim, inicio), 80);
      return { value: n, goal: 80, text: `${n} de 80 pressões` };
    },
    licao: 'Em razão fixa, o reforço depende do número de respostas: quanto mais rápido, mais reforço. A taxa sobe.',
  },
  {
    id: 'extincao',
    titulo: 'Extinção',
    resumo: 'Desligue o reforço e observe.',
    dicas: [
      'Não clique. Observe o que acontece logo depois.',
      'Primeiro vem um surto: ele pressiona mais.',
      'Depois a taxa cai.',
    ],
    alvos: [],
    cliqueManual: false,
    esquema: null,
    luz: null,
    estrelas: [180, 180],
    progresso: (sim, inicio) => {
      const s = Math.min(Math.floor(sim.t - inicio), 180);
      return { value: s, goal: 180, text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} de 3:00 de observação` };
    },
    licao: 'Sem reforço, o comportamento cai, mas não de uma vez: primeiro vem o surto de extinção.',
  },
  {
    id: 'luz',
    titulo: 'Luz que manda',
    resumo: 'Com luz acesa, há reforço. Apagada, não.',
    dicas: [
      'Só observe. A luz troca a cada 20 s.',
      'Aos poucos ele pressiona mais com a luz acesa.',
      'A luz virou estímulo discriminativo (S+).',
    ],
    alvos: [],
    cliqueManual: false,
    esquema: { kind: 'VI', ms: 5000 },
    luz: 20,
    estrelas: [300, 600],
    progresso: sim => {
      const { on, off } = sim.pressesByLight(sim.t - 120);
      const ratio = off === 0 ? on : on / off;
      const ok = on >= 10 && on >= 2 * off;
      return {
        value: ok ? 1 : Math.min(0.95, ratio / 2),
        goal: 1,
        text: `últimos 2 min: ${on} pressões com luz, ${off} sem luz (meta: o dobro com luz)`,
      };
    },
    licao: 'O rato discriminou: a luz sinaliza quando a pressão é reforçada. Isso é controle de estímulos.',
  },
];

export const FREE_MODE = 'livre';
