import type { EventLog } from '../core';

const COLORS = ['#2563eb', '#dc2626'];
const W = 640;
const H = 200;
const PAD = 26;

/** Registro cumulativo: respostas acumuladas no tempo, com marcas de reforço na base. */
export function recordSvg(log: EventLog, durationMs: number, now: number): string {
  const responses = log.ofType('response');
  const reinforcers = log.ofType('reinforcer');
  const levers = Math.max(1, ...log.ofType('schedule_set').map(e => (e.lever ?? 0) + 1));

  const cumulative: Array<Array<[number, number]>> = Array.from({ length: levers }, () => [[0, 0]]);
  const counts = new Array<number>(levers).fill(0);
  for (const e of responses) {
    const lever = e.lever ?? 0;
    counts[lever] += 1;
    cumulative[lever].push([e.t, counts[lever]]);
  }
  const maxY = Math.max(10, ...counts);
  const x = (t: number): number => PAD + (Math.min(t, durationMs) / durationMs) * (W - PAD * 2);
  const y = (n: number): number => H - PAD - (n / maxY) * (H - PAD * 2);

  const lines = cumulative
    .map((points, i) => {
      const last = points[points.length - 1];
      const path = points.map(([t, n]) => `${x(t).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
      return `<polyline class="rec-line" points="${path} ${x(now).toFixed(1)},${y(last[1]).toFixed(1)}" stroke="${COLORS[i % COLORS.length]}"/>`;
    })
    .join('');

  const ticks = reinforcers
    .map(e => {
      const lever = e.lever ?? 0;
      const cls = e.source === 'manual' ? 'tick manual' : 'tick';
      return `<line class="${cls}" x1="${x(e.t).toFixed(1)}" x2="${x(e.t).toFixed(1)}" y1="${H - PAD}" y2="${H - PAD + 10}" stroke="${COLORS[lever % COLORS.length]}"/>`;
    })
    .join('');

  return `
  <svg class="record" viewBox="0 0 ${W} ${H}" role="img" aria-label="Registro cumulativo de respostas">
    <line class="axis" x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}"/>
    <line class="axis" x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}"/>
    <text class="label" x="${PAD}" y="${PAD - 8}">respostas acumuladas</text>
    <text class="label" x="${W - PAD}" y="${H - 4}" text-anchor="end">${Math.round(durationMs / 60_000)} min</text>
    ${lines}
    ${ticks}
  </svg>`;
}
