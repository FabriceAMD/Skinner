import { EventLog } from './log';
import { createRat, type RatConfig, type RatModel } from './rats';
import { mulberry32, type Rng } from './rng';
import { createSchedule, Curriculum, formatSpec, type Schedule, type ScheduleSpec, type Stage } from './schedules';

/** Ações do estudante. Sem `t`: aplicadas no instante atual da sessão. */
export type StudentCommand =
  | { kind: 'set_schedule'; lever: number; spec: ScheduleSpec }
  | { kind: 'set_punish'; lever: number; spec: ScheduleSpec }
  | { kind: 'deliver'; lever: number }
  | { kind: 'note'; text: string };

/** Ação agendada, para rodar sessões em lote (testes, aulas com roteiro). */
export type StudentAction = StudentCommand & { t: number };

export interface SessionConfig {
  seed: number;
  durationMs: number;
  /** Passo de tempo virtual em ms. Padrão: 100. */
  dt?: number;
  rat: RatConfig;
  /** Um esquema de reforço por alavanca. */
  levers: ScheduleSpec[];
  /** Um esquema de punição por alavanca (EXT = sem punição). Padrão: sem punição. */
  punish?: ScheduleSpec[];
  /** Se informado, controla a alavanca 0 com critério de domínio. */
  curriculum?: Stage[];
  actions?: StudentAction[];
}

/** Sessão em tempo virtual que pode ser avançada aos poucos e receber ações do estudante. */
export class Session {
  readonly log = new EventLog();
  private readonly dt: number;
  private readonly rng: Rng;
  private readonly rat: RatModel;
  private readonly schedules: Schedule[];
  private readonly punishers: Schedule[];
  private curriculum: Curriculum | null;
  private readonly scripted: StudentAction[];
  private nextScripted = 0;
  private now = 0;
  private finished = false;
  private lastBehavior: string | undefined;

  constructor(private readonly cfg: SessionConfig) {
    if (cfg.levers.length === 0) throw new Error('É preciso ao menos uma alavanca');
    this.dt = cfg.dt ?? 100;
    this.rng = mulberry32(cfg.seed);
    this.rat = createRat(cfg.rat);
    this.curriculum = cfg.curriculum ? new Curriculum(cfg.curriculum) : null;
    const specs = cfg.levers.map((spec, lever) => (lever === 0 && this.curriculum ? this.curriculum.spec : spec));
    this.schedules = specs.map(spec => createSchedule(spec));
    const punish = cfg.punish ?? specs.map(() => ({ kind: 'EXT' }) as ScheduleSpec);
    this.punishers = specs.map((_, i) => createSchedule(punish[i] ?? { kind: 'EXT' }));
    this.scripted = [...(cfg.actions ?? [])].sort((a, b) => a.t - b.t);

    this.log.add({ t: 0, type: 'session_start', text: `rato=${cfg.rat.id} semente=${cfg.seed}` });
    specs.forEach((spec, lever) => this.log.add({ t: 0, type: 'schedule_set', lever, spec: formatSpec(spec), text: 'inicial' }));
    punish.forEach((spec, lever) => {
      if (spec.kind !== 'EXT') this.log.add({ t: 0, type: 'schedule_set', lever, spec: formatSpec(spec), text: 'punição inicial' });
    });
  }

  get time(): number {
    return this.now;
  }

  get levers(): number {
    return this.schedules.length;
  }

  /** Comportamento e posição do rato agora, se o repertório estiver ligado. */
  get ratState(): { behavior: string; pos: number } | undefined {
    return this.rat.behaviorState?.();
  }

  get ended(): boolean {
    return this.finished;
  }

  /** Avança o tempo virtual até `until` (ms), sem passar da duração da sessão. */
  runTo(until: number): void {
    const end = Math.min(until, this.cfg.durationMs);
    while (this.now < end && !this.finished) {
      this.applyScripted();
      this.tick();
      this.now += this.dt;
    }
  }

  /** Aplica uma ação do estudante no instante atual. */
  act(command: StudentCommand): void {
    if (command.kind === 'note') {
      // anotações e respostas do caderno também valem depois do fim da sessão
      this.log.add({ t: this.now, type: 'note', text: command.text });
      return;
    }
    if (this.finished) throw new Error('Sessão encerrada');
    this.checkLever(command.lever);
    if (command.kind === 'set_schedule') {
      if (command.lever === 0) this.curriculum = null;
      this.schedules[command.lever] = createSchedule(command.spec, this.now);
      this.log.add({ t: this.now, type: 'schedule_set', lever: command.lever, spec: formatSpec(command.spec) });
    } else if (command.kind === 'set_punish') {
      this.punishers[command.lever] = createSchedule(command.spec, this.now);
      this.log.add({
        t: this.now,
        type: 'schedule_set',
        lever: command.lever,
        spec: formatSpec(command.spec),
        text: 'punição',
      });
    } else {
      this.log.add({ t: this.now, type: 'reinforcer', lever: command.lever, source: 'manual' });
      this.rat.onReinforcer(command.lever, this.now);
    }
  }

  /** Encerra a sessão e registra o fim no log. */
  finish(): void {
    if (this.finished) return;
    this.log.add({ t: this.now, type: 'session_end' });
    this.finished = true;
  }

  private logBehavior(now: number): void {
    const state = this.rat.behaviorState?.();
    if (state && state.behavior !== this.lastBehavior) {
      this.lastBehavior = state.behavior;
      this.log.add({ t: now, type: 'behavior', text: state.behavior });
    }
  }

  private checkLever(lever: number): void {
    if (lever < 0 || lever >= this.schedules.length) throw new Error(`Alavanca ${lever} não existe`);
  }

  private applyScripted(): void {
    while (this.nextScripted < this.scripted.length && this.scripted[this.nextScripted].t <= this.now) {
      const { t: _t, ...command } = this.scripted[this.nextScripted++];
      this.act(command);
    }
  }

  private tick(): void {
    const { rng, rat, schedules, log, now } = this;
    const lever = rat.chooseLever(schedules.length, rng);
    const responded = rng() < rat.responseProbability(this.dt, rng);
    this.logBehavior(now);
    if (responded) {
      log.add({ t: now, type: 'response', lever });
      // punição é contingente à resposta na alavanca em que ela ocorreu
      if (this.punishers[lever].step(now, true, rng)) {
        log.add({ t: now, type: 'punishment', lever });
        rat.onPunishment(lever, now);
      }
    }

    schedules.forEach((schedule, i) => {
      if (!schedule.step(now, responded && i === lever, rng)) return;
      log.add({ t: now, type: 'reinforcer', lever: i, source: 'auto' });
      rat.onReinforcer(i, now);
      if (i === 0 && this.curriculum?.onReinforcer()) {
        schedules[0] = createSchedule(this.curriculum.spec, now);
        log.add({ t: now, type: 'stage_change', lever: 0, spec: formatSpec(this.curriculum.spec) });
      }
    });

    rat.advance(this.dt);
  }
}

/** Roda uma sessão inteira em tempo virtual. Mesma configuração e semente geram o mesmo log. */
export function runSession(cfg: SessionConfig): EventLog {
  const session = new Session(cfg);
  session.runTo(cfg.durationMs);
  session.finish();
  return session.log;
}
