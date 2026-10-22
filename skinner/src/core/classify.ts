import type { EventLog } from './log';
import { cv, mean, median, percentile } from './stats';
import { formatSpec, type ScheduleSpec } from './schedules';

/**
 * VARIAVEL agrupa razão variável (VR) e intervalo variável (VI): com resposta de taxa estável,
 * o registro dos dois é estatisticamente igual, então o classificador não os separa.
 */
export type Label = 'sem_dados' | 'EXT' | 'DRO' | 'DRL' | 'FR' | 'FI' | 'VARIAVEL' | 'indeterminado';

export interface Classification {
  label: Label;
  spec?: ScheduleSpec;
  evidence: string[];
}

/** Respostas e reforços de uma alavanca, em ms, ordenados. */
export interface ClassifyInput {
  responses: number[];
  reinforcers: number[];
}

/** Janela (ms) para atribuir um reforço à resposta que o produziu. */
const TAU = 200;
/** Mínimo de reforços para tentar classificar. */
const MIN_REINFORCERS = 5;

export function inputFromLog(log: EventLog, lever: number): ClassifyInput {
  return { responses: log.times('response', lever), reinforcers: log.times('reinforcer', lever) };
}

/** Primeiro índice com valor >= x (array ordenado). */
function lowerBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Quantos valores x satisfazem a < x <= b. */
function countIn(arr: number[], a: number, b: number): number {
  return lowerBound(arr, b + 1) - lowerBound(arr, a + 1);
}

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function classify({ responses, reinforcers }: ClassifyInput): Classification {
  if (responses.length === 0 && reinforcers.length === 0) {
    return { label: 'sem_dados', evidence: ['nada foi registrado'] };
  }
  if (reinforcers.length === 0) {
    return { label: 'EXT', spec: { kind: 'EXT' }, evidence: [`${responses.length} respostas e nenhum reforço`] };
  }
  if (reinforcers.length < MIN_REINFORCERS) {
    return {
      label: 'indeterminado',
      evidence: [`apenas ${reinforcers.length} reforços; são necessários ${MIN_REINFORCERS}`],
    };
  }

  const contingent = reinforcers.filter(r => countIn(responses, r - TAU, r) > 0);
  const share = contingent.length / reinforcers.length;

  if (share <= 0.2) return classifyNoncontingent(responses, reinforcers, share);
  return classifyContingent(responses, reinforcers, contingent);
}

/** Reforços chegam sem resposta imediata: DRO se o intervalo sem resposta for regular. */
function classifyNoncontingent(responses: number[], reinforcers: number[], share: number): Classification {
  const gaps = reinforcers.map(r => {
    const i = lowerBound(responses, r) - 1;
    return i >= 0 ? r - responses[i] : r;
  });
  const typical = median(gaps);
  const regular = gaps.filter(g => g <= 1.2 * typical).length / gaps.length;
  const evidence = [
    `${Math.round((1 - share) * 100)}% dos reforços vieram sem resposta imediata`,
    `intervalo sem resposta até o reforço: mediana ${fmtSec(typical)}, ${Math.round(regular * 100)}% dentro de 20% dela`,
  ];
  if (regular >= 0.8) {
    return { label: 'DRO', spec: { kind: 'DRO', ms: Math.round(typical) }, evidence };
  }
  return { label: 'indeterminado', evidence: [...evidence, 'reforços sem resposta, mas em intervalos irregulares'] };
}

/** Reforços dependem de respostas: DRL, FR, FI, VI ou VR, conforme o padrão. */
function classifyContingent(responses: number[], reinforcers: number[], contingent: number[]): Classification {
  const reinforcedIdx = new Set(contingent.map(r => upperIndex(responses, r)));
  const reinforcedIrts: number[] = [];
  const otherIrts: number[] = [];
  responses.forEach((t, k) => {
    if (k === 0) return;
    (reinforcedIdx.has(k) ? reinforcedIrts : otherIrts).push(t - responses[k - 1]);
  });

  const evidence = [`${contingent.length} de ${reinforcers.length} reforços vieram logo após uma resposta`];

  // DRL: respostas reforçadas têm pausa mínima; as demais ficam abaixo dessa pausa.
  if (reinforcedIrts.length >= 5 && otherIrts.length >= 5) {
    const floor = percentile(reinforcedIrts, 0.1);
    const typicalOther = median(otherIrts);
    if (percentile(otherIrts, 0.9) <= floor && floor >= 1.5 * typicalOther) {
      return {
        label: 'DRL',
        spec: { kind: 'DRL', ms: Math.round(floor) },
        evidence: [...evidence, `respostas reforçadas vieram só após pausas de ${fmtSec(floor)} ou mais`],
      };
    }
  }

  const counts: number[] = [];
  const durations: number[] = [];
  for (let i = 1; i < reinforcers.length; i++) {
    durations.push(reinforcers[i] - reinforcers[i - 1]);
    counts.push(countIn(responses, reinforcers[i - 1], reinforcers[i]));
  }
  const countCv = cv(counts);
  const durationCv = cv(durations);
  const shortest = percentile(durations, 0);
  const typical = median(durations);

  if (countCv <= 0.05) {
    const n = Math.round(median(counts));
    return {
      label: 'FR',
      spec: { kind: 'FR', n },
      evidence: [...evidence, `respostas por reforço fixas: ${n}`],
    };
  }
  if (durationCv <= 0.35 && shortest >= 0.7 * typical) {
    return {
      label: 'FI',
      spec: { kind: 'FI', ms: Math.round(percentile(durations, 0.1)) },
      evidence: [...evidence, `intervalos entre reforços regulares (variação ${durationCv.toFixed(2)})`],
    };
  }
  return {
    label: 'VARIAVEL',
    evidence: [
      ...evidence,
      `intervalos variáveis (variação ${durationCv.toFixed(2)}) e respostas por reforço variáveis (média ${Math.round(mean(counts))})`,
      'razão variável e intervalo variável produzem este mesmo registro com resposta de taxa estável; separá-los exige mudar a taxa do rato',
    ],
  };
}

/** Índice da última resposta até o instante t (inclusive). */
function upperIndex(responses: number[], t: number): number {
  return lowerBound(responses, t + 1) - 1;
}

/** Compara o esquema declarado no caderno com o que o registro mostra. */
export function compareIntent(declared: ScheduleSpec, result: Classification): { match: boolean; text: string } {
  const observed = result.spec;
  if (result.label === 'VARIAVEL' && (declared.kind === 'VR' || declared.kind === 'VI')) {
    return {
      match: true,
      text: `Você declarou ${formatSpec(declared)}. O registro é compatível com razão ou intervalo variável; só ele não separa os dois.`,
    };
  }
  if (!observed) {
    return { match: false, text: `Você declarou ${formatSpec(declared)}. Não foi possível classificar o que foi implementado.` };
  }
  const match = declared.kind === observed.kind && withinTolerance(paramOf(declared), paramOf(observed));
  const verdict = match ? 'Coincide.' : 'Não coincide.';
  return {
    match,
    text: `Você declarou ${formatSpec(declared)}. Pelo registro, a contingência implementada foi ${formatSpec(observed)}. ${verdict}`,
  };
}

function paramOf(spec: ScheduleSpec): number {
  if ('n' in spec) return spec.n;
  if ('ms' in spec) return spec.ms;
  return 0;
}

/** Tolerância de 25%: a variação natural do rato e do registro não deve reprovar uma resposta correta. */
function withinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.25 * Math.max(a, b);
}
