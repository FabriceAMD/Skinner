import ratsRaw from './rats.json';
import type { RatConfig } from '../core';

export type Acessorio = 'gravata' | 'oculos' | 'cracha' | null;

export interface RatEntry extends RatConfig {
  papel: string;
  descricao: string;
  visual: { pelagem: string; cabelo: string | null; acessorio: Acessorio };
}

export const RATS: RatEntry[] = ratsRaw as RatEntry[];

export function findRat(id: string): RatEntry {
  const rat = RATS.find(r => r.id === id);
  if (!rat) throw new Error(`Rato desconhecido: ${id}`);
  return rat;
}
