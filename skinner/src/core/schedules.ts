import type { Rng } from './rng';

export type ScheduleSpec =
  | { kind: 'FR'; n: number }
  | { kind: 'VR'; n: number }
  | { kind: 'FI'; ms: number }
  | { kind: 'VI'; ms: number }
  | { kind: 'DRL'; ms: number }
  | { kind: 'DRO'; ms: number }
  | { kind: 'EXT' };

export interface Schedule {
  readonly spec: ScheduleSpec;
  /** Um passo de simulação. Retorna true se um reforço é entregue neste instante. */
  step(t: number, responded: boolean, rng: Rng): boolean;
}

const expDraw = (mean: number, rng: Rng): number => -mean * Math.log(1 - rng());

export function createSchedule(spec: ScheduleSpec, t0 = 0): Schedule {
  switch (spec.kind) {
    case 'FR': {
      let count = 0;
      return {
        spec,
        step(_t, responded) {
          if (!responded) return false;
          count += 1;
          if (count < spec.n) return false;
          count = 0;
          return true;
        },
      };
    }
    case 'VR':
      return { spec, step: (_t, responded, rng) => responded && rng() < 1 / spec.n };
    case 'FI': {
      let last = t0;
      return {
        spec,
        step(t, responded) {
          if (!responded || t - last < spec.ms) return false;
          last = t;
          return true;
        },
      };
    }
    case 'VI': {
      let target = NaN;
      return {
        spec,
        step(t, responded, rng) {
          if (Number.isNaN(target)) target = t0 + expDraw(spec.ms, rng);
          if (!responded || t < target) return false;
          target = t + expDraw(spec.ms, rng);
          return true;
        },
      };
    }
    case 'DRL': {
      let last = t0;
      return {
        spec,
        step(t, responded) {
          if (!responded) return false;
          const irt = t - last;
          last = t;
          return irt >= spec.ms;
        },
      };
    }
    case 'DRO': {
      let last = t0;
      return {
        spec,
        step(t, responded) {
          if (responded) {
            last = t;
            return false;
          }
          if (t - last < spec.ms) return false;
          last = t;
          return true;
        },
      };
    }
    case 'EXT':
      return { spec, step: () => false };
  }
}

export function formatSpec(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'FR':
    case 'VR':
      return `${spec.kind} ${spec.n}`;
    case 'FI':
    case 'VI':
    case 'DRL':
    case 'DRO':
      return `${spec.kind} ${spec.ms / 1000}s`;
    case 'EXT':
      return 'EXT';
  }
}

/** Critério de domínio (Keller): avança de estágio após um número mínimo de reforços. */
export interface Stage {
  spec: ScheduleSpec;
  minReinforcers: number;
}

export class Curriculum {
  private index = 0;
  private count = 0;

  constructor(private readonly stages: Stage[]) {
    if (stages.length === 0) throw new Error('Currículo sem estágios');
  }

  get spec(): ScheduleSpec {
    return this.stages[this.index].spec;
  }

  /** Registra um reforço automático. Retorna true se o sujeito avançou de estágio. */
  onReinforcer(): boolean {
    this.count += 1;
    const stage = this.stages[this.index];
    if (this.count < stage.minReinforcers || this.index === this.stages.length - 1) return false;
    this.index += 1;
    this.count = 0;
    return true;
  }
}
