import ratsRaw from './rats.json';
import type { RatConfig } from '../core';
import type { Estilo } from '../game/render';

export type Acessorio = 'gravata' | 'oculos' | 'cracha' | null;

export interface RatEntry extends RatConfig {
  papel: string;
  descricao: string;
  visual: { pelagem: string; cabelo: string | null; acessorio: Acessorio; estilo?: Estilo };
  /** Personalidade no jogo, liberada aos poucos. */
  tracos: { aprendizagem: number; ritmo: number; saciedade: number; curiosidade: number };
  /** Traços em palavras curtas, mostrados na prévia quando a personalidade está liberada. */
  jeito: string[];
}

export const RATS: RatEntry[] = ratsRaw as RatEntry[];

export function findRat(id: string): RatEntry {
  const rat = RATS.find(r => r.id === id);
  if (!rat) throw new Error(`Rato desconhecido: ${id}`);
  return rat;
}
