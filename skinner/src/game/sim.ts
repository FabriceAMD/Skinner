import { mulberry32, type Rng } from '../core/rng';
import { createSchedule, formatSpec, type Schedule, type ScheduleSpec } from '../core/schedules';

/**
 * Simulação do rato na caixa. Tempo em segundos "de rato".
 *
 * Princípios (Sniffy, Pryor):
 * - Comportamentos têm força; o rato escolhe o próximo comportamento em proporção à força.
 * - Reforço fortalece o que veio logo antes dele (traço de elegibilidade que decai em ~1 s).
 * - O clique solta uma pelota do teto, no ponto onde o rato está. Ele termina o gesto em curso e come ali.
 * - O clique vira reforçador condicionado com o pareamento clique → comida (vMag, Rescorla-Wagner).
 * - Sem reforço por alguns segundos, a variação se concentra no próximo passo da cadeia (indução pela extinção).
 * - Saciedade: cada pelota sacia; reforço vale menos com o rato saciado.
 * - Extinção: pressão sem reforço perde força e gera frustração (surto de extinção).
 */

export type Behavior =
  | 'explorar'
  | 'farejar'
  | 'levantar'
  | 'limpar'
  | 'comedouro'
  | 'aproximar'
  | 'cheirarBarra'
  | 'apoiar'
  | 'pressionar'
  | 'comer';

/** Comportamentos que o rato escolhe livremente (comer acontece quando ele acha a pelota). */
export type Choice = Exclude<Behavior, 'comer'>;

export const CHOICES: Choice[] = [
  'explorar',
  'farejar',
  'levantar',
  'limpar',
  'comedouro',
  'aproximar',
  'cheirarBarra',
  'apoiar',
  'pressionar',
];

export const LABEL: Record<Behavior, string> = {
  explorar: 'explorar',
  farejar: 'farejar',
  levantar: 'levantar',
  limpar: 'se limpar',
  comedouro: 'procurar comida',
  aproximar: 'ir até a barra',
  cheirarBarra: 'cheirar a barra',
  apoiar: 'apoiar na barra',
  pressionar: 'pressionar a barra',
  comer: 'comer',
};

const BASE: Record<Choice, number> = {
  explorar: 1,
  farejar: 0.8,
  levantar: 0.6,
  limpar: 0.5,
  comedouro: 0.3,
  aproximar: 0.3,
  cheirarBarra: 0.25,
  apoiar: 0.15,
  pressionar: 0.05,
};

const AT_BAR: Choice[] = ['cheirarBarra', 'apoiar', 'pressionar'];
/** Cadeia de modelagem: reforçar um elo também deixa o próximo um pouco mais provável (indução). */
const CHAIN: Choice[] = ['aproximar', 'cheirarBarra', 'apoiar', 'pressionar'];
const INDUCTION = 0.7;
const DURATION: Record<Behavior, number> = {
  explorar: 3.0,
  farejar: 2.1,
  levantar: 1.9,
  limpar: 3.4,
  comedouro: 1.5,
  aproximar: 0.6,
  cheirarBarra: 2.2,
  apoiar: 2.4,
  pressionar: 2.6,
  comer: 1.2,
};

export const BAR_X = 0.86;
const NEAR = 0.07;
const SPEED = 0.25; // larguras da caixa por segundo (rato calmo, fácil de acompanhar)
/** Tolerância ao atraso do clique: o traço do comportamento decai em ~1,5 s. */
const TRACE_TAU = 1.5;
const MAX_W = 8;
/** Soma máxima das forças: reforçar um comportamento tira espaço dos outros (força relativa). */
const TOTAL_CAP = 14;
const MIN_W = 0.02;
const PRESS_EVERY = 0.55;
const SATIETY_PER_PELLET = 0.02;
const EXTINCTION = 0.12;
/** Quanto o reforço numa luz vale na outra. */
const GENERALIZATION = 0.01;
const HUNGER_RECOVERY = 0.003; // por segundo de rato

export interface Brain {
  /** Força dos comportamentos, por contexto de luz. */
  w: Record<'on' | 'off', Record<Choice, number>>;
  /** Quanto o clique já significa comida (0 a 1). */
  vMag: number;
  hunger: number;
}

export function freshBrain(): Brain {
  return { w: { on: { ...BASE }, off: { ...BASE } }, vMag: 0.05, hunger: 1 };
}

export type Quality = 'perfeito' | 'bom' | 'tarde' | 'sem-efeito';

export interface ClickReport {
  t: number;
  reinforced: Behavior;
  delay: number;
  quality: Quality;
  points: number;
  source: 'aluno' | 'automatico';
}

export interface SimEvent {
  t: number;
  kind: 'press' | 'click' | 'eat' | 'light' | 'drop';
  source?: 'aluno' | 'automatico';
  on?: boolean;
  /** Onde a pelota caiu (0 a 1), em eventos `drop`. */
  x?: number;
}

export class Sim {
  t = 0;
  x = 0.5;
  dir = 1;
  behavior: Behavior = 'explorar';
  pellets = 0;
  light = true;
  lightCycle: number | null = null;
  readonly events: SimEvent[] = [];
  readonly reports: ClickReport[] = [];
  /** Comportamentos que contam ponto na missão atual. */
  targets: Behavior[] = [];
  frustration = 0;
  scheduleSpec: ScheduleSpec | null = null;

  private readonly rng: Rng;
  private readonly brain: Brain;
  private readonly learn: number;
  private trace: Record<Behavior, number>;
  private lastActive: Record<Behavior, number>;
  private behaviorEnd = 0;
  private targetX = 0.5;
  private intent: Choice | null = null;
  private nextPress = 0;
  private lastPressReinforced = true;
  /** Expectativa de reforço por pressão, separada por contexto de luz. */
  private expectation: Record<'on' | 'off', number> = { on: 0, off: 0 };
  private reinforcedPresses: Record<'on' | 'off', number> = { on: 0, off: 0 };
  private lastClick = -Infinity;
  /** Quando o rato para para comer: termina o gesto em curso antes (compromisso motor). */
  private feedAt = Infinity;
  /** Último comportamento reforçado; a extinção faz variar em torno do passo seguinte a ele. */
  private lastReinforced: Choice | null = null;
  private schedule: Schedule | null = null;
  /** Preferência por lugar: onde o rato costuma ganhar reforço, e o quanto isso puxa a exploração. */
  private favX = 0.5;
  private placeStrength = 0;

  constructor(seed: number, brain: Brain = freshBrain(), learn = 1) {
    this.rng = mulberry32(seed);
    this.brain = brain;
    this.learn = learn;
    this.trace = Object.fromEntries([...CHOICES, 'comer'].map(b => [b, 0])) as Record<Behavior, number>;
    this.lastActive = Object.fromEntries([...CHOICES, 'comer'].map(b => [b, -Infinity])) as Record<Behavior, number>;
    this.pick();
  }

  get hunger(): number {
    return this.brain.hunger;
  }

  get vMag(): number {
    return this.brain.vMag;
  }

  get context(): 'on' | 'off' {
    return this.lightCycle === null || this.light ? 'on' : 'off';
  }

  /** Força atual dos comportamentos no contexto de luz atual. */
  strengths(): Record<Choice, number> {
    return { ...this.brain.w[this.context] };
  }

  snapshot(): Brain {
    return JSON.parse(JSON.stringify(this.brain)) as Brain;
  }

  setSchedule(spec: ScheduleSpec | null): void {
    this.scheduleSpec = spec;
    this.schedule = spec ? createSchedule(spec, this.t * 1000) : null;
  }

  scheduleLabel(): string {
    return this.scheduleSpec ? formatSpec(this.scheduleSpec) : 'desligado';
  }

  setLightCycle(seconds: number | null): void {
    this.lightCycle = seconds;
    this.light = true;
  }

  /** Clique + pelota. O clique reforça na hora, se o rato já aprendeu o que ele significa. */
  click(source: 'aluno' | 'automatico' = 'aluno'): ClickReport {
    this.events.push({ t: this.t, kind: 'click', source });
    this.pellets = Math.min(3, this.pellets + 1);
    this.lastClick = this.t;
    this.events.push({ t: this.t, kind: 'drop', x: this.x });
    if (this.behavior === 'pressionar' || this.t - this.lastPressTime() < 1) this.lastPressReinforced = true;

    const reinforced = this.dominant();
    const delay = this.behavior === reinforced ? 0 : this.t - this.lastActive[reinforced];
    const value = this.brain.vMag * this.value();
    this.reinforce(value);
    this.favX += 0.4 * (this.x - this.favX);
    this.placeStrength = Math.min(0.7, this.placeStrength + 0.15 * value);

    let quality: Quality;
    if (this.brain.vMag < 0.15) quality = 'sem-efeito';
    else if (delay < 0.6) quality = 'perfeito';
    else if (delay < 1.6) quality = 'bom';
    else quality = 'tarde';
    const hit = this.targets.includes(reinforced);
    const points = !hit || quality === 'sem-efeito' ? 0 : quality === 'perfeito' ? 100 : quality === 'bom' ? 60 : 20;
    const report: ClickReport = { t: this.t, reinforced, delay, quality, points, source };
    this.reports.push(report);

    if (reinforced !== 'comer') this.lastReinforced = reinforced;

    // a pelota cai onde ele está; gesto dirigido à barra termina antes, o resto para logo
    if (this.behavior !== 'comer') {
      const chain = CHAIN.includes(this.behavior as Choice);
      this.feedAt = Math.min(this.feedAt, this.t + (chain ? Math.min(0.6, this.behaviorEnd - this.t) : 0.25));
    }
    return report;
  }

  /** Avança a simulação. */
  step(dt: number): void {
    this.t += dt;
    this.updateLight();
    for (const b of Object.keys(this.trace) as Behavior[]) this.trace[b] *= Math.exp(-dt / TRACE_TAU);
    this.trace[this.behavior] = 1;
    this.lastActive[this.behavior] = this.t;
    this.brain.hunger = Math.min(1, this.brain.hunger + HUNGER_RECOVERY * dt);
    this.frustration *= Math.exp(-dt / 6);
    this.placeStrength *= Math.exp(-dt / 120);
    this.drift(dt);

    this.move(dt);
    let pressed = false;
    const canPress = this.behavior === 'pressionar' || this.behavior === 'apoiar';
    if (canPress && this.atBar() && this.t >= this.nextPress) {
      pressed = true;
      this.press();
      // apoiar só empurra a barra por acidente, uma vez
      // incentivo: pressiona mais rápido quando espera reforço neste contexto (e quando frustrado)
      const incentive = 0.5 + this.expectation[this.context];
      this.nextPress = this.behavior === 'apoiar' ? Infinity : this.t + PRESS_EVERY / (incentive * (1 + this.frustration));
    }
    if (this.schedule && this.schedule.step(this.t * 1000, pressed, this.rng) && this.light) {
      this.click('automatico');
    }

    if (this.pellets > 0 && this.behavior !== 'comer' && this.t >= this.feedAt) this.start('comer');

    if (this.t >= this.behaviorEnd) this.endBehavior();
  }

  private press(): void {
    this.events.push({ t: this.t, kind: 'press' });
    // pressionar, mesmo por acidente, é pressionar: o reforço que vier logo depois pega essa resposta
    this.trace.pressionar = 1;
    this.lastActive.pressionar = this.t;
    const ctx = this.context;
    if (!this.lastPressReinforced) {
      // extinção pesa quando o rato esperava reforço neste contexto; na modelagem a expectativa é quase zero
      const w = this.brain.w[ctx];
      const e = this.expectation[ctx];
      // rato com muito histórico de reforço continua extinguindo mesmo quando a expectativa já caiu
      const k = EXTINCTION * (this.reinforcedPresses[ctx] > 10 ? Math.max(0.4, e) : e);
      w.pressionar -= k * (w.pressionar - BASE.pressionar);
      // a cadeia que leva à barra também enfraquece, só neste contexto de luz
      for (const b of ['aproximar', 'cheirarBarra', 'apoiar'] as const) w[b] -= (k / 2) * (w[b] - BASE[b]);
      this.frustration = Math.min(2, this.frustration + e * 0.25);
      this.expectation[ctx] = e * 0.95;
      // corrida de razão: quem espera reforço continua pressionando em vez de trocar de comportamento
      if (this.behavior === 'pressionar' && e > 0.3) this.behaviorEnd = Math.max(this.behaviorEnd, this.t + PRESS_EVERY * 1.5);
    } else {
      this.expectation[ctx] += 0.2 * (1 - this.expectation[ctx]);
      this.reinforcedPresses[ctx] += 1;
      // sem luz de estímulo, os dois contextos são a mesma caixa
      if (this.lightCycle === null) {
        const other = ctx === 'on' ? 'off' : 'on';
        this.expectation[other] = this.expectation[ctx];
        this.reinforcedPresses[other] = this.reinforcedPresses[ctx];
      }
    }
    this.lastPressReinforced = false;
  }

  private lastPressTime(): number {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].kind === 'press') return this.events[i].t;
    return -Infinity;
  }

  private value(): number {
    return Math.max(0.05, this.brain.hunger);
  }

  private reinforce(value: number): void {
    const ctx = this.context;
    const other = ctx === 'on' ? 'off' : 'on';
    for (const b of CHOICES) {
      const trace = this.trace[b];
      if (trace < 0.05) continue;
      const delta = this.learn * value * trace;
      this.add(ctx, other, b, delta);
      const link = CHAIN.indexOf(b);
      if (link >= 0 && link < CHAIN.length - 1) this.add(ctx, other, CHAIN[link + 1], delta * INDUCTION);
    }
    this.normalize(ctx);
    this.normalize(other);
  }

  private normalize(ctx: 'on' | 'off'): void {
    const w = this.brain.w[ctx];
    const total = CHOICES.reduce((sum, b) => sum + w[b], 0);
    if (total <= TOTAL_CAP) return;
    const k = TOTAL_CAP / total;
    for (const b of CHOICES) w[b] = Math.max(MIN_W, w[b] * k);
  }

  private add(ctx: 'on' | 'off', other: 'on' | 'off', b: Choice, delta: number): void {
    this.brain.w[ctx][b] = Math.min(MAX_W, this.brain.w[ctx][b] + delta);
    // sem luz de estímulo, os dois contextos são a mesma caixa; com luz, generaliza pouco
    if (this.lightCycle !== null) this.brain.w[other][b] = Math.min(MAX_W, this.brain.w[other][b] + delta * GENERALIZATION);
    else this.brain.w[other][b] = this.brain.w[ctx][b];
  }

  private dominant(): Behavior {
    let best: Behavior = this.behavior;
    let bestTrace = -1;
    for (const b of Object.keys(this.trace) as Behavior[]) {
      if (b === 'comer') continue;
      // em empate, vale o elo mais avançado (pressionar vem depois de apoiar)
      if (this.trace[b] >= bestTrace) {
        best = b;
        bestTrace = this.trace[b];
      }
    }
    return best;
  }

  /** Forças voltam devagar para a linha de base. */
  private drift(dt: number): void {
    for (const ctx of ['on', 'off'] as const) {
      const w = this.brain.w[ctx];
      for (const b of CHOICES) w[b] += (BASE[b] - w[b]) * 0.0005 * dt;
    }
  }

  private updateLight(): void {
    if (this.lightCycle === null) return;
    const on = Math.floor(this.t / this.lightCycle) % 2 === 0;
    if (on !== this.light) {
      this.light = on;
      this.events.push({ t: this.t, kind: 'light', on });
      // mudança de estímulo interrompe o que o rato fazia: ele escolhe de novo, já no novo contexto
      if (this.behavior !== 'comer') this.pick();
    }
  }

  private atBar(): boolean {
    return Math.abs(this.x - BAR_X) < NEAR;
  }

  private move(dt: number): void {
    const moving = this.behavior === 'explorar' || this.behavior === 'comedouro' || this.behavior === 'aproximar';
    if (!moving) return;
    const d = this.targetX - this.x;
    if (Math.abs(d) < 0.01) {
      if (this.behavior === 'aproximar') {
        const next = this.intent;
        this.intent = null;
        if (next) this.start(next);
        else this.behaviorEnd = this.t;
      }
      return;
    }
    this.dir = Math.sign(d);
    this.x += Math.sign(d) * Math.min(Math.abs(d), SPEED * dt * (this.behavior === 'explorar' ? 0.6 : 1));
  }

  private endBehavior(): void {
    // ainda tem pelota no chão: come a próxima
    if (this.pellets > 0) {
      this.start('comer');
      return;
    }
    if (this.behavior === 'aproximar' && this.intent) return; // ainda caminhando
    this.pick();
  }

  private eat(): void {
    if (this.pellets <= 0) return;
    this.pellets -= 1;
    this.events.push({ t: this.t, kind: 'eat' });
    const sinceClick = this.t - this.lastClick;
    // comida é o reforçador primário; pesa menos quando o clique já faz esse papel
    this.reinforce(this.value() * 0.5 * (1 - this.brain.vMag));
    const rate = sinceClick < 3 ? 0.3 : 0.1;
    this.brain.vMag += rate * (1 - this.brain.vMag);
    this.brain.hunger = Math.max(0, this.brain.hunger - SATIETY_PER_PELLET);
    if (this.pellets === 0) this.feedAt = Infinity;
  }

  private pick(): void {
    const w = this.brain.w[this.context];
    const lazy = 0.4 + 0.6 * this.brain.hunger;
    const weights = CHOICES.map(b => w[b] * (b === 'limpar' ? 1 : lazy));
    // indução pela extinção: segurar o reforço faz aparecer o passo seguinte ao que vinha sendo reforçado
    const link = this.lastReinforced ? CHAIN.indexOf(this.lastReinforced) : -1;
    if (link >= 0 && link < CHAIN.length - 1) {
      const extinction = Math.min(1, Math.max(0, (this.t - this.lastClick - 4) / 13));
      const sum = weights.reduce((a, b) => a + b, 0);
      weights[CHOICES.indexOf(CHAIN[link + 1])] += 0.35 * extinction * sum;
    }
    const total = weights.reduce((a, b) => a + b, 0);
    let u = this.rng() * total;
    let choice: Choice = 'explorar';
    for (let i = 0; i < CHOICES.length; i++) {
      u -= weights[i];
      if (u < 0) {
        choice = CHOICES[i];
        break;
      }
    }
    if (choice === 'aproximar' && this.atBar()) choice = 'cheirarBarra';
    if (AT_BAR.includes(choice) && !this.atBar()) {
      this.intent = choice;
      this.start('aproximar');
      return;
    }
    this.start(choice);
  }

  private start(b: Behavior): void {
    if (b === 'comer') this.eat();
    if (b !== 'aproximar') this.intent = null;
    this.behavior = b;
    const jitter = 0.6 + this.rng() * 0.8;
    this.behaviorEnd = this.t + DURATION[b] * jitter;
    if (b === 'explorar') {
      this.targetX =
        this.rng() < this.placeStrength
          ? Math.min(0.92, Math.max(0.08, this.favX + (this.rng() - 0.5) * 0.2))
          : 0.08 + this.rng() * 0.84;
    }
    // procurar comida: fareja em volta de onde está
    else if (b === 'comedouro') this.targetX = Math.min(0.92, Math.max(0.08, this.x + (this.rng() - 0.5) * 0.2));
    else if (b === 'aproximar') {
      this.targetX = BAR_X;
      this.behaviorEnd = this.t + 30;
    }
    if (b === 'pressionar') this.nextPress = this.t + 0.2;
    else if (b === 'apoiar') this.nextPress = this.rng() < 0.5 ? this.t + 0.4 : Infinity;
    else this.nextPress = Infinity;
  }

  /** Pressões desde `from`, separadas pela luz em que aconteceram. */
  pressesByLight(from: number): { on: number; off: number } {
    let light = true;
    let on = 0;
    let off = 0;
    for (const e of this.events) {
      if (e.kind === 'light') light = !!e.on;
      if (e.kind === 'press' && e.t >= from) light ? on++ : off++;
    }
    return { on, off };
  }

  /** Pressões nos últimos `seconds` segundos. */
  pressesSince(seconds: number): number {
    const from = this.t - seconds;
    return this.events.filter(e => e.kind === 'press' && e.t >= from).length;
  }
}
