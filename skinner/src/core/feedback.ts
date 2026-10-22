import type { EventLog } from './log';
import { BEHAVIOR_LABEL, type Behavior } from './repertoire';

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
  const changes = log.ofType('schedule_set').filter(e => e.text === undefined);
  const punishSets = log.ofType('schedule_set').filter(e => e.text === 'punição');
  const minutes = durationMs / 60_000;

  statements.push(
    changes.length > 0
      ? `Você mudou o esquema ${changes.length} ${plural(changes.length, 'vez', 'vezes')} em ${minutes.toFixed(1)} min.`
      : 'Você não mudou o esquema durante a sessão.',
  );

  if (punishSets.length > 0) {
    statements.push(`Você configurou ${punishSets.length} ${plural(punishSets.length, 'esquema de punição', 'esquemas de punição')}.`);
  }

  const punishments = log.ofType('punishment').length;
  if (punishments > 0) {
    statements.push(`Foram registradas ${punishments} ${plural(punishments, 'punição', 'punições')}, todas depois de respostas.`);
  }

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

  statements.push(...timingFeedback(log));
  return statements;
}

/**
 * Timing do reforço: o que o rato fazia no instante de cada reforço à mão, e quanto tempo se passou
 * desde o último toque na barra. É aqui que o estudante vê o que está fortalecendo.
 */
export function timingFeedback(log: EventLog): string[] {
  const behaviors = log.ofType('behavior');
  if (behaviors.length === 0) return [];
  const behaviorAt = (t: number): Behavior => {
    let current: Behavior = 'corner';
    for (const e of behaviors) {
      if (e.t > t) break;
      current = e.text as Behavior;
    }
    return current;
  };

  const manual = log.ofType('reinforcer').filter(e => e.source === 'manual');
  const lines: string[] = [];
  if (manual.length === 0) return lines;

  const counts = new Map<Behavior, number>();
  for (const r of manual) {
    const b = behaviorAt(r.t);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const parts = [...counts].map(([b, n]) => `${n} ${BEHAVIOR_LABEL[b]}`);
  lines.push(`Dos seus reforços à mão, ${parts.join(', ')}. O que o rato fazia no instante do reforço é o que ficou mais provável.`);

  const touches = behaviors.filter(e => e.text === 'touch' || e.text === 'press');
  const gaps: number[] = [];
  for (const r of manual) {
    const last = [...touches].reverse().find(e => e.t <= r.t);
    if (last && r.t - last.t <= 3000) gaps.push(r.t - last.t);
  }
  if (gaps.length > 0) {
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000;
    lines.push(`Seu reforço chegou em média ${avg.toFixed(1)} s depois do último toque na barra (${gaps.length} casos).`);
  }
  return lines;
}

export interface MethodCheck {
  ok: boolean;
  text: string;
}

/**
 * Práticas de método observáveis no registro. Descrevem o que foi feito; não avaliam o resultado.
 */
export function methodChecks(log: EventLog): MethodCheck[] {
  const changes = log.ofType('schedule_set').filter(e => e.text === undefined && e.t > 0);
  const punishSets = log.ofType('schedule_set').filter(e => e.text === 'punição');
  const manual = log.ofType('reinforcer').filter(e => e.source === 'manual');
  const last = log.all.length > 0 ? log.all[log.all.length - 1].t : 0;

  return [
    { ok: changes.length > 0, text: 'Testou uma mudança de esquema' },
    { ok: punishSets.length > 0, text: 'Testou uma punição' },
    { ok: manual.length > 0, text: 'Entregou reforço à mão' },
    { ok: last >= 5 * 60_000, text: 'Deixou a sessão rodar por pelo menos 5 min' },
  ];
}
