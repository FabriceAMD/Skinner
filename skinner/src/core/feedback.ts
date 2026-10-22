import type { EventLog } from './log';

const WINDOW_MS = 60_000;

const fmtClock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Descreve, sem julgar, o comportamento do estudante registrado no log.
 * Só afirma o que foi observado; não elogia nem corrige.
 */
export function describeSession(log: EventLog, durationMs: number): string[] {
  const statements: string[] = [];
  const changes = log.ofType('schedule_set').filter(e => e.text !== 'inicial');
  const minutes = durationMs / 60_000;

  statements.push(
    changes.length > 0
      ? `Você mudou o esquema ${changes.length} ${plural(changes.length, 'vez', 'vezes')} em ${minutes.toFixed(1)} min.`
      : 'Você não mudou o esquema durante a sessão.',
  );

  const reinforcers = log.ofType('reinforcer');
  const manual = reinforcers.filter(e => e.source === 'manual').length;
  statements.push(
    manual > 0
      ? `Você entregou ${manual} de ${reinforcers.length} reforços à mão (${Math.round((100 * manual) / reinforcers.length)}%).`
      : 'Nenhum reforço foi entregue à mão.',
  );

  const responseTimes = log.ofType('response');
  const rateBetween = (lever: number, a: number, b: number): number | null => {
    if (b <= a) return null;
    const n = responseTimes.filter(e => e.lever === lever && e.t > a && e.t <= b).length;
    return Math.round(n / ((b - a) / 60_000));
  };

  for (const change of changes.slice(0, 5)) {
    const lever = change.lever ?? 0;
    const before = rateBetween(lever, Math.max(0, change.t - WINDOW_MS), change.t);
    const after = rateBetween(lever, change.t, Math.min(durationMs, change.t + WINDOW_MS));
    const afterText = after === null ? 'sem tempo para medir' : `${after}/min`;
    const beforeText = before === null ? '' : ` Nos 60 s anteriores: ${before}/min.`;
    statements.push(
      `Após ${change.spec} na alavanca ${lever + 1}, aos ${fmtClock(change.t)}: ${afterText}.${beforeText}`,
    );
  }

  const allResponses = responseTimes.map(e => e.t);
  const latencies: number[] = [];
  for (const r of reinforcers) {
    const next = allResponses.find(t => t > r.t);
    if (next !== undefined && next - r.t <= 30_000) latencies.push(next - r.t);
  }
  if (latencies.length > 0) {
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000;
    statements.push(
      `Em média, a primeira resposta depois de um reforço veio ${avg.toFixed(1)} s depois (${latencies.length} casos).`,
    );
  }

  return statements;
}
