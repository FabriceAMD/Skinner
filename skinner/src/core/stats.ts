export const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function percentile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export const median = (xs: number[]): number => percentile(xs, 0.5);

/** Coeficiente de variação (desvio padrão / média). */
export function cv(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) / m;
}
