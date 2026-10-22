import type { RatEntry } from '../content';

export type RatPose = 'idle' | 'press' | 'eat';

/** Rato desenhado em SVG. A cor vem do cadastro; o cabelo e a gravata são opcionais. */
export function ratSvg(visual: RatEntry['visual'], pose: RatPose): string {
  const hair = visual.cabelo
    ? `<path d="M30 36 q4 -16 18 -14 q-2 6 -4 10 q8 -4 12 2 q-10 4 -26 2 z" fill="${visual.cabelo}"/>`
    : '';
  const tie = visual.gravata ? `<path d="M64 80 l-4 5 l4 12 l4 -12 z" fill="#2c3e50"/>` : '';
  return `
  <svg class="rat pose-${pose}" viewBox="0 0 120 110" aria-hidden="true">
    <path class="tail" d="M92 84 q24 -6 20 -30" fill="none" stroke="#e7a6a6" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="66" cy="76" rx="30" ry="22" fill="${visual.pelagem}"/>
    <ellipse cx="34" cy="58" rx="16" ry="14" fill="${visual.pelagem}"/>
    <ellipse cx="30" cy="44" rx="7" ry="8" fill="#f2b8b8"/>
    ${hair}
    <circle cx="26" cy="56" r="2.4" fill="#222"/>
    <ellipse cx="17" cy="61" rx="3" ry="2.4" fill="#e88"/>
    ${tie}
    <ellipse class="paw" cx="46" cy="94" rx="8" ry="4" fill="${visual.pelagem}"/>
    <ellipse cx="82" cy="94" rx="7" ry="4" fill="${visual.pelagem}"/>
  </svg>`;
}
