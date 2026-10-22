import ratsRaw from './rats.json';
import lessonsRaw from './lessons.json';
import narracaoRaw from './narracao.json';
import type { RatConfig, ScheduleSpec, Stage } from '../core';

export type Acessorio = 'gravata' | 'oculos' | 'cracha' | null;

export interface RatEntry extends RatConfig {
  papel: string;
  descricao: string;
  visual: { pelagem: string; cabelo: string | null; acessorio: Acessorio };
}

export interface Lesson {
  id: string;
  titulo: string;
  rato: string;
  duracaoMin: number;
  objetivo: string;
  alavancas: ScheduleSpec[];
  curriculo?: Stage[];
  punicao?: ScheduleSpec[];
  perguntas: string[];
}

const KINDS = ['FR', 'VR', 'FI', 'VI', 'DRL', 'DRO', 'EXT'] as const;

/** Converte o JSON de esquema para ScheduleSpec, rejeitando formas inválidas. */
export function parseSpec(raw: unknown): ScheduleSpec {
  const r = raw as { kind?: string; n?: number; ms?: number };
  if (!r || !KINDS.includes(r.kind as (typeof KINDS)[number])) throw new Error(`Esquema inválido: ${JSON.stringify(raw)}`);
  if (r.kind === 'EXT') return { kind: 'EXT' };
  if (r.kind === 'FR' || r.kind === 'VR') {
    if (typeof r.n !== 'number' || r.n < 1) throw new Error(`n inválido em ${JSON.stringify(raw)}`);
    return { kind: r.kind, n: r.n };
  }
  if (typeof r.ms !== 'number' || r.ms <= 0) throw new Error(`ms inválido em ${JSON.stringify(raw)}`);
  return { kind: r.kind as 'FI' | 'VI' | 'DRL' | 'DRO', ms: r.ms };
}

export const RATS: RatEntry[] = ratsRaw as RatEntry[];

export type NarrationKey = keyof typeof narracaoRaw;
export const NARRACAO: Record<NarrationKey, string[]> = narracaoRaw;

/** Frase de narração escolhida de forma estável pelo instante do evento (mesma sessão, mesma frase). */
export function narrate(key: NarrationKey, seedTime: number): string {
  const lines = NARRACAO[key];
  return lines[Math.floor(seedTime / 100) % lines.length];
}

export const LESSONS: Lesson[] = (lessonsRaw as Array<Record<string, unknown>>).map(raw => ({
  id: raw.id as string,
  titulo: raw.titulo as string,
  rato: raw.rato as string,
  duracaoMin: raw.duracaoMin as number,
  objetivo: raw.objetivo as string,
  alavancas: (raw.alavancas as unknown[]).map(parseSpec),
  curriculo: raw.curriculo
    ? (raw.curriculo as Array<{ spec: unknown; minReinforcers: number }>).map(s => ({
        spec: parseSpec(s.spec),
        minReinforcers: s.minReinforcers,
      }))
    : undefined,
  punicao: raw.punicao ? (raw.punicao as unknown[]).map(parseSpec) : undefined,
  perguntas: raw.perguntas as string[],
}));

export function findRat(id: string): RatEntry {
  const rat = RATS.find(r => r.id === id);
  if (!rat) throw new Error(`Rato desconhecido: ${id}`);
  return rat;
}
