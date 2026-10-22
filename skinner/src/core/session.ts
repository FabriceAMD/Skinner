import { EventLog } from './log';
import { createRat, type RatConfig } from './rats';
import { mulberry32 } from './rng';
import { createSchedule, Curriculum, formatSpec, type ScheduleSpec, type Stage } from './schedules';

/** Ações do estudante durante a sessão. Ficam no log, junto com o comportamento do rato. */
export type StudentAction =
  | { t: number; kind: 'set_schedule'; lever: number; spec: ScheduleSpec }
  | { t: number; kind: 'deliver'; lever: number }
  | { t: number; kind: 'note'; text: string };

export interface SessionConfig {
  seed: number;
  durationMs: number;
  /** Passo de tempo virtual em ms. Padrão: 100. */
  dt?: number;
  rat: RatConfig;
  /** Um esquema por alavanca. */
  levers: ScheduleSpec[];
  /** Se informado, controla a alavanca 0 com critério de domínio. */
  curriculum?: Stage[];
  actions?: StudentAction[];
}

/** Roda uma sessão inteira em tempo virtual. Mesma configuração e semente geram o mesmo log. */
export function runSession(cfg: SessionConfig): EventLog {
  if (cfg.levers.length === 0) throw new Error('É preciso ao menos uma alavanca');
  const dt = cfg.dt ?? 100;
  const rng = mulberry32(cfg.seed);
  const rat = createRat(cfg.rat);
  const log = new EventLog();

  let curriculum = cfg.curriculum ? new Curriculum(cfg.curriculum) : null;
  const specs = cfg.levers.map((spec, lever) => (lever === 0 && curriculum ? curriculum.spec : spec));
  const schedules = specs.map(spec => createSchedule(spec));

  const actions = [...(cfg.actions ?? [])].sort((a, b) => a.t - b.t);
  let nextAction = 0;

  log.add({ t: 0, type: 'session_start', text: `rato=${cfg.rat.id} semente=${cfg.seed}` });
  specs.forEach((spec, lever) => log.add({ t: 0, type: 'schedule_set', lever, spec: formatSpec(spec), text: 'inicial' }));

  for (let t = 0; t < cfg.durationMs; t += dt) {
    while (nextAction < actions.length && actions[nextAction].t <= t) {
      const action = actions[nextAction++];
      if (action.kind === 'note') {
        log.add({ t, type: 'note', text: action.text });
        continue;
      }
      if (action.lever < 0 || action.lever >= schedules.length) {
        throw new Error(`Alavanca ${action.lever} não existe`);
      }
      if (action.kind === 'set_schedule') {
        if (action.lever === 0) curriculum = null;
        schedules[action.lever] = createSchedule(action.spec, t);
        log.add({ t, type: 'schedule_set', lever: action.lever, spec: formatSpec(action.spec) });
      } else {
        log.add({ t, type: 'reinforcer', lever: action.lever, source: 'manual' });
        rat.onReinforcer(action.lever, t);
      }
    }

    const lever = rat.chooseLever(schedules.length, rng);
    const responded = rng() < rat.responseProbability(dt, rng);
    if (responded) log.add({ t, type: 'response', lever });

    schedules.forEach((schedule, i) => {
      if (!schedule.step(t, responded && i === lever, rng)) return;
      log.add({ t, type: 'reinforcer', lever: i, source: 'auto' });
      rat.onReinforcer(i, t);
      if (i === 0 && curriculum?.onReinforcer()) {
        schedules[0] = createSchedule(curriculum.spec, t);
        log.add({ t, type: 'stage_change', lever: 0, spec: formatSpec(curriculum.spec) });
      }
    });

    rat.advance(dt);
  }

  log.add({ t: cfg.durationMs, type: 'session_end' });
  return log;
}
