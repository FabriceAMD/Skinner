import type { Rng } from './rng';

/** Configuração de um rato. Campos ausentes assumem os valores de DEFAULTS. */
export interface RatConfig {
  id: string;
  name: string;
  model: 'molar' | 'keller';
  baseRate?: number;
  maxRate?: number;
  halfRate?: number;
  windowMs?: number;
  learnRate?: number;
  forgetPerMin?: number;
  noise?: number;
  explore?: number;
  /** Quanto cada punição reduz a propensão a responder (0 a 1). */
  punishGain?: number;
}

const DEFAULTS = {
  baseRate: 10, // respostas/min sem reforço
  maxRate: 60, // acréscimo máximo de respostas/min
  halfRate: 10, // molar: reforços/min que dão metade do acréscimo
  windowMs: 300_000, // molar: janela para medir a taxa de reforço (5 min, evita oscilação)
  learnRate: 0.3, // keller: força aprendida por reforço
  forgetPerMin: 0.05, // keller: fração da força perdida por minuto
  noise: 0.2, // variação multiplicativa por passo
  explore: 0.2, // molar: fração de escolhas uniformes; evita o colapso para uma alavanca só
  punishGain: 0.2, // fração da propensão perdida a cada punição
};

/**
 * Modelo de rato. Os dois modelos respondem a reforços e punições de formas distintas:
 * - molar: taxa de resposta sobe de forma hiperbólica com a taxa de reforço (Herrnstein), e a escolha
 *   entre alavancas segue a lei da igualação. Punição suprime a taxa e a supressão passa com o tempo.
 * - keller: força de resposta aprendida reforço a reforço e esquecida com o tempo; punição desgasta a força.
 */
export interface RatModel {
  readonly config: RatConfig;
  chooseLever(levers: number, rng: Rng): number;
  responseProbability(dt: number, rng: Rng): number;
  onReinforcer(lever: number, t: number): void;
  onPunishment(lever: number, t: number): void;
  advance(dt: number): void;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

class MolarRat implements RatModel {
  private readonly p: typeof DEFAULTS & RatConfig;
  private now = 0;
  private suppression = 0;
  private reinforcers: { t: number; lever: number }[] = [];

  constructor(readonly config: RatConfig) {
    this.p = { ...DEFAULTS, ...config };
  }

  private recent(lever?: number): { t: number; lever: number }[] {
    const from = this.now - this.p.windowMs;
    while (this.reinforcers.length > 0 && this.reinforcers[0].t < from) this.reinforcers.shift();
    return this.reinforcers.filter(r => lever === undefined || r.lever === lever);
  }

  chooseLever(levers: number, rng: Rng): number {
    if (levers === 1) return 0;
    const counts = Array.from({ length: levers }, (_, i) => this.recent(i).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const e = this.p.explore;
    // lei da igualação: alocação proporcional aos reforços recentes, com uma parcela de exploração
    const shares = counts.map(c => (total === 0 ? 1 / levers : (1 - e) * (c / total) + e / levers));
    let u = rng();
    for (let i = 0; i < levers; i++) {
      u -= shares[i];
      if (u < 0) return i;
    }
    return levers - 1;
  }

  responseProbability(dt: number, rng: Rng): number {
    const perMin = this.recent().length / (this.p.windowMs / 60_000);
    const rate = this.p.baseRate + this.p.maxRate * (perMin / (perMin + this.p.halfRate));
    const suppressed = rate * (1 - 0.7 * this.suppression);
    return clamp01(suppressed * (dt / 60_000) * (1 + this.p.noise * (2 * rng() - 1)));
  }

  onReinforcer(lever: number, t: number): void {
    this.reinforcers.push({ t, lever });
  }

  onPunishment(): void {
    this.suppression += this.p.punishGain * (1 - this.suppression);
  }

  advance(dt: number): void {
    this.now += dt;
    this.suppression *= Math.exp(-0.5 * (dt / 60_000));
  }
}

class KellerRat implements RatModel {
  private readonly p: typeof DEFAULTS & RatConfig;
  private strength = 0.1;

  constructor(readonly config: RatConfig) {
    this.p = { ...DEFAULTS, ...config };
  }

  chooseLever(levers: number, rng: Rng): number {
    return Math.floor(rng() * levers);
  }

  responseProbability(dt: number, rng: Rng): number {
    const rate = this.p.baseRate + this.p.maxRate * this.strength;
    return clamp01(rate * (dt / 60_000) * (1 + this.p.noise * (2 * rng() - 1)));
  }

  onReinforcer(): void {
    this.strength += this.p.learnRate * (1 - this.strength);
  }

  onPunishment(): void {
    this.strength *= 1 - this.p.punishGain;
  }

  advance(dt: number): void {
    this.strength *= Math.exp(-this.p.forgetPerMin * (dt / 60_000));
  }
}

export function createRat(config: RatConfig): RatModel {
  return config.model === 'molar' ? new MolarRat(config) : new KellerRat(config);
}
