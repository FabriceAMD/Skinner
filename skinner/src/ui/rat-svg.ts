import type { RatEntry } from '../content';

export type RatPose = 'idle' | 'press' | 'eat';

/** Rato desenhado em SVG. A cor vem do cadastro; o cabelo e a gravata são opcionais. */
export function ratSvg(visual: RatEntry['visual'], pose: RatPose): string {
  const hair = visual.cabelo
    ? `<path d="M30 36 q4 -16 18 -14 q-2 6 -4 10 q8 -4 12 2 q-10 4 -26 2 z" fill="${visual.cabelo}"/>`
    : '';
  // gravata: nó pequeno e corpo comprido, bem visível sobre o peito
  const tie =
    visual.acessorio === 'gravata'
      ? `<path d="M60 74 h9 l-1.5 5 h-6 z" fill="#b91c1c"/><path d="M60.5 79 h8 l3 22 l-7 4 l-7 -4 z" fill="#b91c1c"/>`
      : '';
  const glasses =
    visual.acessorio === 'oculos'
      ? `<circle cx="27" cy="54" r="4" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="38" cy="54" r="4" fill="none" stroke="#333" stroke-width="1.5"/>`
      : '';
  const badge = visual.acessorio === 'cracha' ? `<rect x="58" y="72" width="8" height="10" rx="1" fill="#fff" stroke="#555"/>` : '';
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
    ${glasses}
    ${badge}
    <ellipse class="paw" cx="46" cy="94" rx="8" ry="4" fill="${visual.pelagem}"/>
    <ellipse cx="82" cy="94" rx="7" ry="4" fill="${visual.pelagem}"/>
  </svg>`;
}
