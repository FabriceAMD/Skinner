import { MISSIONS, type Mission, type Progress } from './missions';
import type { Behavior, ClickReport, Sim } from './sim';

const STEP = 0.05;
/** Acertos seguidos na etapa de modelagem antes de subir o critério. */
const HITS_PER_STEP = 2;
/** Sem acerto por esse tempo (segundos reais), o critério desce uma etapa. */
const STEP_BACK_AFTER = 45;
/** Depois disso (segundos reais) na mesma fase, a deixa fica mais chamativa. */
const STRONG_CUE_AFTER = 60;

export interface Result {
  stars: number;
  realSeconds: number;
}

/**
 * Uma missão em andamento: quanto tempo corre, quando o botão acende, quando sobe a etapa de modelagem
 * e quando termina. Não sabe nada de tela; o jogo e o simulador de usuário usam esta mesma classe.
 */
export class Flow {
  readonly mission: Mission;
  readonly startT: number;
  stepIndex = 0;
  realElapsed = 0;
  score = 0;
  result: Result | null = null;
  /** Velocidade escolhida pelo jogador; sem escolha, vale a da missão. */
  speedOverride: number | null = null;
  private stepHits = 0;
  private lastHit = 0;
  private pending = 0;

  /** `index` é a posição em MISSIONS; -1 para o laboratório livre. */
  constructor(
    readonly index: number,
    readonly sim: Sim,
    mission: Mission = MISSIONS[index],
  ) {
    this.mission = mission;
    this.startT = sim.t;
    sim.setSchedule(this.mission.esquema);
    sim.setLightCycle(this.mission.luz);
    sim.targets = this.targets;
  }

  get speed(): number {
    return this.speedOverride ?? this.mission.velocidade;
  }

  get targets(): Behavior[] {
    const etapas = this.mission.etapas;
    return etapas ? etapas[this.stepIndex].alvos : this.mission.alvos;
  }

  progress(): Progress {
    return this.mission.progresso(this.sim, this.startT);
  }

  /** O botão acende quando é uma boa hora de clicar. É a única instrução que o jogador precisa. */
  cue(): boolean {
    const { sim, mission } = this;
    if (!mission.cliqueManual || this.result) return false;
    if (mission.deixa === 'pronto') return sim.pellets === 0 && sim.behavior !== 'comer' && sim.behavior !== 'comedouro';
    if (mission.deixa === 'alvo') {
      if (sim.pellets > 0) return false;
      // na etapa final, a barra descer é a deixa, mesmo que tenha sido ao apoiar
      const onlyPress = this.targets.length === 1 && this.targets[0] === 'pressionar';
      if (onlyPress && sim.pressesSince(0.5) > 0) return true;
      return this.targets.includes(sim.behavior) || this.inZone();
    }
    return false;
  }

  /** Quem está demorando ganha uma deixa mais chamativa (pulso forte e vibração). */
  get strongCue(): boolean {
    return this.realElapsed > STRONG_CUE_AFTER;
  }

  /** Com pelota esperando no comedouro, o botão fica bloqueado: o rato ainda nem comeu a última. */
  get canClick(): boolean {
    return this.mission.cliqueManual && !this.result && this.sim.pellets === 0;
  }

  /** Etapa com zona: qualquer comportamento (menos comer) com o rato perto da barra vale. */
  private inZone(): boolean {
    const etapa = this.mission.etapas?.[this.stepIndex];
    if (!etapa?.zona) return false;
    const b = this.sim.behavior;
    return this.sim.x >= etapa.zona && b !== 'comer' && b !== 'comedouro';
  }

  click(): ClickReport | null {
    if (!this.canClick) return null;
    const zoneHit = this.inZone();
    const report = this.sim.click('aluno');
    if (zoneHit && report.points === 0 && report.quality !== 'sem-efeito') report.points = 50;
    this.score += report.points;
    const etapas = this.mission.etapas;
    if (etapas && report.points > 0 && (report.quality === 'perfeito' || report.quality === 'bom' || zoneHit)) {
      this.lastHit = this.realElapsed;
      this.stepHits += 1;
      if (this.stepHits >= HITS_PER_STEP && this.stepIndex < etapas.length - 1) {
        this.stepIndex += 1;
        this.stepHits = 0;
        this.sim.targets = this.targets;
      }
    }
    return report;
  }

  /** Avança o tempo real; a simulação corre na velocidade da missão. */
  advance(realSeconds: number): void {
    if (this.result) return;
    this.realElapsed += realSeconds;
    // sem progresso, volta um passo: critério mais fácil, como faria um bom treinador
    if (this.mission.etapas && this.stepIndex > 0 && this.realElapsed - this.lastHit > STEP_BACK_AFTER) {
      this.stepIndex -= 1;
      this.stepHits = 0;
      this.lastHit = this.realElapsed;
      this.sim.targets = this.targets;
    }
    this.pending += realSeconds * this.speed;
    while (this.pending >= STEP) {
      this.sim.step(STEP);
      this.pending -= STEP;
    }
    const p = this.progress();
    if (p.value >= p.goal) {
      const [three, two] = this.mission.estrelas;
      const stars = this.realElapsed <= three ? 3 : this.realElapsed <= two ? 2 : 1;
      this.result = { stars, realSeconds: this.realElapsed };
    }
  }

  get isLast(): boolean {
    return this.index === MISSIONS.length - 1;
  }
}
