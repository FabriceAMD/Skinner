import type { Rng } from './rng';

/** Comportamentos do rato. `press` é a única resposta registrada pelo sistema. */
export type Behavior = 'corner' | 'walk' | 'rear' | 'approach' | 'touch' | 'press';

export const BEHAVIOR_LABEL: Record<Behavior, string> = {
  corner: 'no canto',
  walk: 'andando',
  rear: 'em pé',
  approach: 'indo até a barra',
  touch: 'tocando a barra',
  press: 'pressionando a barra',
};

/** Peso inicial de cada comportamento. Pressionar começa raro, como em um rato sem treino. */
const BASE: Record<Behavior, number> = { corner: 1.5, walk: 1, rear: 1, approach: 0.8, touch: 0.2, press: 0.05 };
/** Posição (0 a 1) a partir da qual o rato alcança a barra. */
export const BAR_POS = 0.9;
const EPISODE_MS = 1000;
const SUSTAINED_MS = 4000;
/** Janela de contiguidade: reforço só fortalece o que aconteceu nessa janela antes dele. */
const CONTIGUITY_MS = 1500;
const MAX_WEIGHT = 10;

interface Episode {
  start: number;
  end: number;
  behavior: Behavior;
}

/**
 * Repertório de comportamentos com posição na caixa. Cada comportamento dura cerca de 1 s e
 * tem peso próprio. Reforço e punição mudam os pesos dos comportamentos que vieram logo antes.
 */
export class Repertoire {
  pos = 0;
  behavior: Behavior = 'corner';
  private readonly weights: Record<Behavior, number> = { ...BASE };
  private episodes: Episode[] = [];
  private episodeStart = 0;
  private now = 0;

  constructor(private readonly gain = 0.6) {}

  weight(b: Behavior): number {
    return this.weights[b];
  }

  export(): Partial<Record<Behavior, number>> {
    return { ...this.weights };
  }

  import(saved: Partial<Record<Behavior, number>>): void {
    for (const b of Object.keys(saved) as Behavior[]) {
      const w = saved[b];
      if (w !== undefined) this.weights[b] = w;
    }
  }

  /** Um passo de simulação: pode trocar o comportamento e move o rato. */
  step(dt: number, rng: Rng): Behavior {
    this.now += dt;
    const s = dt / 1000;
    // aproximação e toque duram mais: o rato vai até a barra antes de mudar de ideia
    const sustained = this.behavior === 'approach' || (this.behavior === 'touch' && this.pos < BAR_POS);
    if (rng() < dt / (sustained ? SUSTAINED_MS : EPISODE_MS)) this.switchTo(this.pick(rng));

    switch (this.behavior) {
      case 'corner':
        this.pos -= 0.2 * s;
        break;
      case 'walk':
        this.pos += (rng() - 0.5) * 0.8 * s;
        break;
      case 'approach':
        this.pos += 0.5 * s;
        break;
      case 'touch':
        if (this.pos < BAR_POS) this.pos += 0.5 * s;
        break;
      default:
        break;
    }
    this.pos = Math.min(1, Math.max(0, this.pos));

    // pesos voltam devagar para a linha de base
    for (const b of Object.keys(BASE) as Behavior[]) {
      this.weights[b] += (BASE[b] - this.weights[b]) * (dt / 60_000);
    }
    return this.behavior;
  }

  /** Reforço em `t`: fortalece os comportamentos em curso na janela de contiguidade. */
  reinforce(t: number): void {
    for (const b of this.recentBehaviors(t)) {
      this.weights[b] = Math.min(MAX_WEIGHT, this.weights[b] * (1 + this.gain));
      // pressionar é vizinho topográfico de tocar: reforçar o toque também fortalece a pressão
      if (b === 'touch') this.weights.press = Math.min(MAX_WEIGHT, this.weights.press * (1 + this.gain / 2));
    }
  }

  /** Punição em `t`: enfraquece os comportamentos em curso na janela de contiguidade. */
  punish(t: number): void {
    for (const b of this.recentBehaviors(t)) {
      this.weights[b] = Math.max(0.01, this.weights[b] * (1 - this.gain * 0.5));
    }
  }

  private recentBehaviors(t: number): Set<Behavior> {
    const found = new Set<Behavior>();
    const all = [...this.episodes, { start: this.episodeStart, end: this.now, behavior: this.behavior }];
    for (const e of all) {
      if (e.start <= t && e.end >= t - CONTIGUITY_MS) found.add(e.behavior);
    }
    return found;
  }

  private switchTo(next: Behavior): void {
    if (next === this.behavior) return;
    this.episodes.push({ start: this.episodeStart, end: this.now, behavior: this.behavior });
    this.episodes = this.episodes.filter(e => e.end >= this.now - CONTIGUITY_MS * 4);
    this.behavior = next;
    this.episodeStart = this.now;
  }

  private pick(rng: Rng): Behavior {
    const order = Object.keys(this.weights) as Behavior[];
    const total = order.reduce((sum, b) => sum + this.weights[b], 0);
    let u = rng() * total;
    for (const b of order) {
      u -= this.weights[b];
      if (u < 0) return b;
    }
    return 'corner';
  }
}
