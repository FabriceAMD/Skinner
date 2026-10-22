import { RATS, type RatEntry } from '../content';
import type { ScheduleSpec } from '../core/schedules';
import { Sound } from './audio';
import { Flow } from './flow';
import { LIVRE, MISSIONS } from './missions';
import { drawRecord, H, Renderer, W, type RatLook } from './render';
import { CHOICES, freshBrain, LABEL, Sim, type Behavior, type Brain, type ClickReport } from './sim';
import { mountTicker } from './ticker';

const SPEEDS = [1, 2, 4];
const CELEBRATION_MS = 2500;

const KEY_PROGRESS = 'cs2:progresso';
const KEY_RAT = 'cs2:rato';
const brainKey = (id: string): string => `cs2:cerebro:${id}`;

/** localStorage pode estar bloqueado; o jogo funciona sem ele, só não lembra. */
const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sem persistência */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* sem persistência */
    }
  },
};

/** Emoji de cada comportamento: o jogador vê o que o rato faz sem ler. */
const EMOJI: Record<Behavior, string> = {
  explorar: '🐭',
  farejar: '👃',
  levantar: '🧍',
  limpar: '🧼',
  comedouro: '🍽️',
  aproximar: '➡️',
  cheirarBarra: '👃',
  apoiar: '🐾',
  pressionar: '⬇️',
  comer: '😋',
};

const FREE_SCHEDULES: Array<{ label: string; spec: ScheduleSpec | null }> = [
  { label: '✋ Só você clica', spec: null },
  { label: 'CRF: toda pressão', spec: { kind: 'FR', n: 1 } },
  { label: 'FR 5', spec: { kind: 'FR', n: 5 } },
  { label: 'FR 15', spec: { kind: 'FR', n: 15 } },
  { label: 'VR 5', spec: { kind: 'VR', n: 5 } },
  { label: 'VI 10 s', spec: { kind: 'VI', ms: 10_000 } },
  { label: 'FI 15 s', spec: { kind: 'FI', ms: 15_000 } },
  { label: 'Extinção', spec: { kind: 'EXT' } },
];

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

const lookOf = (rat: RatEntry): RatLook => ({
  pelagem: rat.visual.pelagem,
  cabelo: rat.visual.cabelo,
  acessorio: rat.visual.acessorio,
});

/** Ratos com aprendizagem mais rápida aprendem um pouco mais por reforço. */
const learnOf = (rat: RatEntry): number => 0.8 + (rat.learnRate ?? 0.3);

interface Progresso {
  estrelas: Record<string, number>;
}

export function startGame(root: HTMLElement): void {
  mountTicker();
  new Game(root).home();
}

class Game {
  private ratId: string;
  private progress: Progresso;
  private sound = new Sound();

  private sim: Sim | null = null;
  private flow: Flow | null = null;
  private renderer: Renderer | null = null;
  private recordCanvas: HTMLCanvasElement | null = null;
  private rafId = 0;
  private lastFrame: number | null = null;
  private seenEvents = 0;
  private lastPanel = 0;
  private paused = false;
  private wasCue = false;
  private celebrateUntil = 0;
  private tab: 'mente' | 'registro' = 'mente';

  constructor(private readonly root: HTMLElement) {
    this.ratId = store.get<string>(KEY_RAT) ?? RATS[0].id;
    if (!RATS.some(r => r.id === this.ratId)) this.ratId = RATS[0].id;
    this.progress = store.get<Progresso>(KEY_PROGRESS) ?? { estrelas: {} };
    root.addEventListener('click', e => this.onClick(e));
    root.addEventListener('change', e => this.onChange(e));
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && this.flow && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        this.studentClick();
      }
    });
  }

  private get rat(): RatEntry {
    return RATS.find(r => r.id === this.ratId) ?? RATS[0];
  }

  private unlocked(index: number): boolean {
    return index === 0 || (this.progress.estrelas[MISSIONS[index - 1].id] ?? 0) > 0;
  }

  /** Primeira missão ainda não feita; se todas foram feitas, recomeça do início. */
  private nextIndex(): number {
    const i = MISSIONS.findIndex(m => !this.progress.estrelas[m.id]);
    return i === -1 ? 0 : i;
  }

  // ---------------- início: tudo numa tela, sem rolar ----------------

  home(): void {
    this.stop();
    const total = Object.values(this.progress.estrelas).reduce((a, b) => a + b, 0);
    const started = total > 0;
    const missions = MISSIONS.map((m, i) => {
      const s = this.progress.estrelas[m.id] ?? 0;
      const open = this.unlocked(i);
      return `<button class="m-dot ${open ? '' : 'locked'} ${s ? 'done' : ''}" data-mission="${i}" ${open ? '' : 'disabled'} aria-label="${esc(m.titulo)}">
        <span class="m-icon">${open ? m.icone : '🔒'}</span><span class="m-stars">${s ? stars(s) : ''}</span>
      </button>`;
    }).join('');
    const rats = RATS.map(
      r => `<button class="rat-chip ${r.id === this.ratId ? 'on' : ''}" data-rat="${r.id}"><i style="background:${r.visual.pelagem}"></i>${esc(r.name)}</button>`,
    ).join('');

    this.root.innerHTML = `
      <main class="home">
        <header class="title">
          <h1>Caixa Skinner</h1>
          <p>Treine um rato com o clique 🔔</p>
        </header>
        <button class="btn play" data-action="play">▶ ${started ? 'Continuar' : 'Jogar'}</button>
        <div class="m-row">${missions}</div>
        <p class="total">${total} / ${MISSIONS.length * 3} ★</p>
        <div class="rats">${rats}</div>
        <div class="home-links">
          <button class="link" data-action="free">🧪 laboratório livre</button>
          ${store.get<Brain>(brainKey(this.ratId)) ? '<button class="link" data-action="new-rat">🔄 rato novo</button>' : ''}
        </div>
        <footer class="credits">Inspirado no Sniffy (Alloway, Wilson e Graham) e no Training Game de Karen Pryor.</footer>
      </main>`;
  }

  // ---------------- jogo ----------------

  private start(index: number): void {
    if (!this.sim) {
      const brain = store.get<Brain>(brainKey(this.ratId)) ?? freshBrain();
      this.sim = new Sim(Math.floor(Math.random() * 1e9), brain, learnOf(this.rat));
    }
    this.flow = index >= 0 ? new Flow(index, this.sim) : new Flow(-1, this.sim, LIVRE);
    this.celebrateUntil = 0;
    this.mountPlay();
  }

  private mountPlay(): void {
    const flow = this.flow;
    if (!flow) return;
    const m = flow.mission;
    const free = flow.index < 0;
    const trail = free
      ? `<span class="trail-free">${m.icone} ${esc(m.titulo)}</span>`
      : MISSIONS.map((x, i) => `<span class="t-dot ${i === flow.index ? 'on' : i < flow.index ? 'past' : ''}">${x.icone}</span>`).join('');

    this.root.innerHTML = `
      <main class="game">
        <header class="bar">
          <button class="icon" data-action="home" aria-label="voltar">←</button>
          <div class="trail">${trail}</div>
          <button class="icon" data-action="sound" aria-label="som">${this.sound.enabled ? '🔊' : '🔇'}</button>
        </header>

        <div class="goal">
          <div class="steps" data-role="steps"></div>
          <div class="progress"><i data-role="goal-bar"></i></div>
        </div>

        <div class="stage">
          <canvas width="${W}" height="${H}" data-role="canvas" aria-label="caixa de Skinner"></canvas>
          <div class="hud"><span data-role="behavior"></span><span data-role="speed-badge"></span></div>
        </div>

        <div class="action" data-role="action">
          ${m.cliqueManual
            ? `<button class="btn click" data-action="click" aria-label="clique e pelota">🔔</button>`
            : `<canvas class="mini-record" width="640" height="150" data-role="mini-record" aria-label="registro cumulativo"></canvas>`}
        </div>

        ${free ? this.freeControls() : ''}

        <details class="more">
          <summary>🧠 mente do rato · 📈 registro · ⏩ velocidade</summary>
          <div class="speed">
            <button class="icon" data-action="pause">${this.paused ? '▶' : '⏸'}</button>
            ${SPEEDS.map(s => `<button class="pill ${flow.speedOverride === s ? 'on' : ''}" data-speed="${s}">${s}×</button>`).join('')}
            <button class="pill ${flow.speedOverride === null ? 'on' : ''}" data-speed="auto">auto</button>
          </div>
          <nav class="tabs">
            <button data-tab="mente" class="${this.tab === 'mente' ? 'on' : ''}">🧠 mente</button>
            <button data-tab="registro" class="${this.tab === 'registro' ? 'on' : ''}">📈 registro</button>
          </nav>
          <section class="panel" data-role="panel"></section>
        </details>

        <div class="modal hidden" data-role="modal"></div>
      </main>`;

    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-role=canvas]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    this.renderer = new Renderer(ctx);
    canvas.addEventListener('pointerdown', () => this.studentClick());
    this.recordCanvas = null;
    this.seenEvents = this.sim?.events.length ?? 0;
    this.lastFrame = null;
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.frame);
  }

  private freeControls(): string {
    const sim = this.sim;
    const options = FREE_SCHEDULES.map(
      (s, i) => `<option value="${i}" ${JSON.stringify(s.spec) === JSON.stringify(sim?.scheduleSpec ?? null) ? 'selected' : ''}>${s.label}</option>`,
    ).join('');
    return `
      <div class="free">
        <label>⚙️<select data-field="schedule">${options}</select></label>
        <label>💡<select data-field="light">
          <option value="off" ${sim?.lightCycle === null ? 'selected' : ''}>sem luz</option>
          <option value="on" ${sim?.lightCycle !== null ? 'selected' : ''}>luz: S+ / S−</option>
        </select></label>
      </div>`;
  }

  private frame = (now: number): void => {
    const flow = this.flow;
    const sim = this.sim;
    if (!flow || !sim || !this.renderer) return;
    if (!this.paused && this.lastFrame !== null) flow.advance(Math.min(0.25, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.handleEvents(now);
    this.renderer.draw(sim, lookOf(this.rat), now);
    this.updateHud(now);
    if (flow.result && this.celebrateUntil === 0) this.celebrate(now);
    if (this.celebrateUntil > 0 && now >= this.celebrateUntil && !flow.isLast) {
      this.next();
      return;
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  /** Sons e efeitos para eventos novos da simulação. */
  private handleEvents(now: number): void {
    const sim = this.sim;
    if (!sim || !this.renderer) return;
    for (; this.seenEvents < sim.events.length; this.seenEvents++) {
      const e = sim.events[this.seenEvents];
      if (e.kind === 'press') this.sound.press();
      else if (e.kind === 'click' && e.source === 'automatico') {
        this.sound.click();
        this.sound.pellet();
      } else if (e.kind === 'eat') this.renderer.burst(now, sim);
    }
  }

  private studentClick(): void {
    const flow = this.flow;
    const sim = this.sim;
    if (!flow || !sim || !this.renderer || flow.result) return;
    const report = flow.click();
    if (!report) return;
    this.seenEvents = sim.events.length;
    this.sound.click();
    this.sound.pellet();
    const { text, color } = describe(report, flow.targets.length > 0 || !!flow.mission.etapas);
    this.renderer.float(text, color, performance.now(), sim);
  }

  private updateHud(now: number): void {
    const flow = this.flow;
    const sim = this.sim;
    if (!flow || !sim) return;
    const q = <T extends Element>(sel: string): T | null => this.root.querySelector<T>(sel);
    const m = flow.mission;

    const behavior = q<HTMLElement>('[data-role=behavior]');
    if (behavior) behavior.textContent = `${EMOJI[sim.behavior]} ${LABEL[sim.behavior]}`;
    const badge = q<HTMLElement>('[data-role=speed-badge]');
    if (badge) badge.textContent = flow.speed > 1 ? `⏩ ${flow.speed}×` : '';

    // etapas da modelagem em ícones; nas outras fases, só o ícone da fase
    const steps = q<HTMLElement>('[data-role=steps]');
    if (steps) {
      const html = m.etapas
        ? m.etapas.map((e, i) => `<span class="step ${i === flow.stepIndex ? 'on' : i < flow.stepIndex ? 'past' : ''}">${e.icone}</span>`).join('<span class="arrow">›</span>')
        : `<span class="step on">${m.icone}</span><span class="step-title">${esc(m.titulo)}</span>`;
      if (steps.dataset.html !== html) {
        steps.innerHTML = html;
        steps.dataset.html = html;
      }
    }
    const bar = q<HTMLElement>('[data-role=goal-bar]');
    if (bar) {
      const p = flow.progress();
      bar.style.width = `${Math.min(100, (p.value / p.goal) * 100)}%`;
    }

    const button = q<HTMLButtonElement>('[data-action=click]');
    if (button) {
      const cue = flow.cue();
      button.classList.toggle('cue', cue);
      button.classList.toggle('strong', cue && flow.strongCue);
      button.classList.toggle('wait', !flow.canClick);
      if (cue && !this.wasCue && flow.strongCue) navigator.vibrate?.(40);
      this.wasCue = cue;
    }
    const mini = q<HTMLCanvasElement>('[data-role=mini-record]');
    if (mini) drawRecord(mini, sim, flow.startT, 60);

    if (now - this.lastPanel > 400) {
      this.lastPanel = now;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    const sim = this.sim;
    const flow = this.flow;
    const panel = this.root.querySelector<HTMLElement>('[data-role=panel]');
    const details = this.root.querySelector<HTMLDetailsElement>('details.more');
    if (!sim || !flow || !panel || !details?.open) return;
    if (this.tab === 'mente') {
      const w = sim.strengths();
      const total = CHOICES.reduce((sum, b) => sum + w[b], 0);
      const bars = CHOICES.map(b => {
        const pct = Math.round((w[b] / total) * 100);
        return `<div class="meter-row ${flow.targets.includes(b) ? 'target' : ''}"><span>${EMOJI[b]} ${esc(LABEL[b])}</span><b><i style="width:${pct}%"></i></b><em>${pct}%</em></div>`;
      }).join('');
      panel.innerHTML = `${bars}
        <div class="meter-row special"><span>🔔 = 🍽️</span><b><i style="width:${Math.round(sim.vMag * 100)}%"></i></b><em>${Math.round(sim.vMag * 100)}%</em></div>
        <div class="meter-row special"><span>😋 fome</span><b><i style="width:${Math.round(sim.hunger * 100)}%"></i></b><em>${Math.round(sim.hunger * 100)}%</em></div>`;
    } else {
      if (!this.recordCanvas || !panel.contains(this.recordCanvas)) {
        panel.innerHTML = '<canvas width="640" height="200" data-role="record"></canvas>';
        this.recordCanvas = panel.querySelector<HTMLCanvasElement>('[data-role=record]');
      }
      if (this.recordCanvas) drawRecord(this.recordCanvas, sim, flow.startT);
    }
  }

  private celebrate(now: number): void {
    const flow = this.flow;
    if (!flow?.result) return;
    const m = flow.mission;
    const before = this.progress.estrelas[m.id] ?? 0;
    this.progress.estrelas[m.id] = Math.max(before, flow.result.stars);
    store.set(KEY_PROGRESS, this.progress);
    this.saveBrain();
    this.celebrateUntil = now + CELEBRATION_MS;
    const modal = this.root.querySelector<HTMLElement>('[data-role=modal]');
    if (!modal) return;
    const total = Object.values(this.progress.estrelas).reduce((a, b) => a + b, 0);
    modal.classList.remove('hidden');
    modal.innerHTML = flow.isLast
      ? `<div class="done card" data-action="home">
          <div class="big">🏆</div>
          <div class="big-stars">${stars(flow.result.stars)}</div>
          <p>${esc(m.licao)}</p>
          <p class="total">${total} / ${MISSIONS.length * 3} ★</p>
          <div class="row"><button class="btn primary" data-action="free">🧪 laboratório livre</button><button class="btn" data-action="home">🏠</button></div>
        </div>`
      : `<div class="done card" data-action="next">
          <div class="big">${m.icone}</div>
          <div class="big-stars">${stars(flow.result.stars)}</div>
          <p>${esc(m.licao)}</p>
          <div class="countdown"><i></i></div>
        </div>`;
  }

  private next(): void {
    const flow = this.flow;
    if (!flow) return;
    this.start(flow.index + 1);
  }

  private saveBrain(): void {
    if (this.sim) store.set(brainKey(this.ratId), this.sim.snapshot());
  }

  private stop(): void {
    cancelAnimationFrame(this.rafId);
    if (this.sim) this.saveBrain();
    this.sim = null;
    this.flow = null;
    this.renderer = null;
    this.recordCanvas = null;
  }

  // ---------------- eventos ----------------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-mission],[data-rat],[data-speed],[data-tab]');
    if (!el) return;
    if (el.dataset.mission !== undefined) {
      this.stop();
      this.start(Number(el.dataset.mission));
      return;
    }
    if (el.dataset.rat) {
      this.ratId = el.dataset.rat;
      store.set(KEY_RAT, this.ratId);
      this.home();
      return;
    }
    if (el.dataset.speed && this.flow) {
      this.flow.speedOverride = el.dataset.speed === 'auto' ? null : Number(el.dataset.speed);
      this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.classList.toggle('on', b === el));
      return;
    }
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as 'mente' | 'registro';
      this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.classList.toggle('on', b === el));
      this.recordCanvas = null;
      this.renderPanel();
      return;
    }
    switch (el.dataset.action) {
      case 'play':
        this.stop();
        this.start(this.nextIndex());
        break;
      case 'free':
        this.stop();
        this.start(-1);
        break;
      case 'click':
        this.studentClick();
        break;
      case 'next':
        this.next();
        break;
      case 'home':
        this.home();
        break;
      case 'pause':
        this.paused = !this.paused;
        el.textContent = this.paused ? '▶' : '⏸';
        break;
      case 'sound':
        this.sound.enabled = !this.sound.enabled;
        el.textContent = this.sound.enabled ? '🔊' : '🔇';
        break;
      case 'new-rat':
        store.remove(brainKey(this.ratId));
        this.progress = { estrelas: {} };
        store.set(KEY_PROGRESS, this.progress);
        this.home();
        break;
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLSelectElement;
    const sim = this.sim;
    if (!sim) return;
    if (el.dataset.field === 'schedule') sim.setSchedule(FREE_SCHEDULES[Number(el.value)].spec);
    if (el.dataset.field === 'light') sim.setLightCycle(el.value === 'on' ? 20 : null);
  }
}

/** Texto curto do que o clique fez, para aparecer em cima do rato. */
function describe(report: ClickReport, scoring: boolean): { text: string; color: string } {
  const what = `${EMOJI[report.reinforced]} ${LABEL[report.reinforced]}`;
  if (report.quality === 'sem-efeito') return { text: '🔔 ?', color: '#64748b' };
  if (!scoring) return { text: `+ ${what}`, color: '#7c3aed' };
  if (report.points === 0) return { text: `😬 ${what}`, color: '#ea580c' };
  if (report.quality === 'perfeito') return { text: `✨ ${what}`, color: '#15803d' };
  return { text: `👍 ${what}`, color: '#0d9488' };
}
