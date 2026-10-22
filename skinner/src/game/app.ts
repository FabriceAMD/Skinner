import { RATS, type RatEntry } from '../content';
import type { ScheduleSpec } from '../core/schedules';
import { Sound } from './audio';
import { MISSIONS, type Mission } from './missions';
import { drawRecord, H, Renderer, W, type RatLook } from './render';
import { CHOICES, freshBrain, LABEL, Sim, type Brain, type ClickReport } from './sim';
import { mountTicker } from './ticker';

const SPEEDS = [1, 2, 4];
/** Começa em 1×: a janela de tolerância do clique fica em segundos reais. Acelere nas fases automáticas. */
const DEFAULT_SPEED = 0;
const STEP = 0.05;

const KEY_PROGRESS = 'cs2:progresso';
const KEY_RAT = 'cs2:rato';
const KEY_INTRO = 'cs2:intro';
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

const FREE_SCHEDULES: Array<{ label: string; spec: ScheduleSpec | null }> = [
  { label: 'Desligado (você clica)', spec: null },
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

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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
  private mission: Mission | null = null;
  private startT = 0;
  private renderer: Renderer | null = null;
  private recordCanvas: HTMLCanvasElement | null = null;
  private speed = DEFAULT_SPEED;
  private paused = false;
  private done = false;
  private score = 0;
  private rafId = 0;
  private lastFrame: number | null = null;
  private pending = 0;
  private seenEvents = 0;
  private lastPanel = 0;
  private tipIndex = 0;
  private lastTip = 0;
  private tab: 'mente' | 'registro' | 'caixa' = 'mente';

  constructor(private readonly root: HTMLElement) {
    this.ratId = store.get<string>(KEY_RAT) ?? RATS[0].id;
    if (!RATS.some(r => r.id === this.ratId)) this.ratId = RATS[0].id;
    this.progress = store.get<Progresso>(KEY_PROGRESS) ?? { estrelas: {} };
    root.addEventListener('click', e => this.onClick(e));
    root.addEventListener('change', e => this.onChange(e));
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && this.sim && !(e.target instanceof HTMLInputElement)) {
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

  // ---------------- tela inicial ----------------

  home(): void {
    this.stop();
    const introSeen = store.get<boolean>(KEY_INTRO) === true;
    const brain = store.get<Brain>(brainKey(this.ratId));
    const total = Object.values(this.progress.estrelas).reduce((a, b) => a + b, 0);

    const rats = RATS.map(
      r => `<button class="rat-chip ${r.id === this.ratId ? 'on' : ''}" data-rat="${r.id}">
        <i style="background:${r.visual.pelagem}"></i>${esc(r.name)}
      </button>`,
    ).join('');

    const missions = MISSIONS.map((m, i) => {
      const stars = this.progress.estrelas[m.id] ?? 0;
      const open = this.unlocked(i);
      return `<button class="mission-card ${open ? '' : 'locked'}" data-mission="${m.id}" ${open ? '' : 'disabled'}>
        <span class="num">${i + 1}</span>
        <span class="body"><strong>${esc(m.titulo)}</strong><small>${open ? esc(m.resumo) : '🔒 conclua a anterior'}</small></span>
        <span class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
      </button>`;
    }).join('');

    this.root.innerHTML = `
      <main class="home">
        <header class="title">
          <h1>Caixa Skinner</h1>
          <p>Treine um rato de laboratório com o clique, como no laboratório de verdade, só que mais rápido.</p>
        </header>

        ${introSeen ? '' : `
        <section class="card how">
          <h2>Como se joga</h2>
          <ol>
            <li><b>Clique</b> (botão grande, toque na caixa ou barra de espaço) entrega uma pelota de comida.</li>
            <li>O que o rato faz <b>no instante do clique</b> (ou até 1 segundo antes) fica mais provável. Atrasou demais, reforçou outra coisa.</li>
            <li>Primeiro ensine que o clique significa comida. Depois, modele a pressão na barra.</li>
          </ol>
          <p class="note">⏩ Quando ele já souber o que fazer, acelere o tempo (2× ou 4×) e veja o comportamento render mais rápido.</p>
          <button class="btn primary" data-action="intro-ok">Entendi</button>
        </section>`}

        <section class="card">
          <h2>Seu rato</h2>
          <div class="rats">${rats}</div>
          <p class="note">${brain ? `🧠 ${esc(this.rat.name)} lembra do que aprendeu. <button class="link" data-action="new-rat">recomeçar do zero</button>` : `${esc(this.rat.name)} ainda não aprendeu nada.`}</p>
        </section>

        <section class="card">
          <h2>Missões <small>${total} de ${MISSIONS.length * 3} ★</small></h2>
          <div class="missions">${missions}</div>
          <button class="btn ghost wide" data-mission="livre">🧪 Laboratório livre</button>
        </section>

        <footer class="credits">
          Inspirado no Sniffy, the Virtual Rat (Alloway, Wilson e Graham) e no Training Game de Karen Pryor.
          O rato é um modelo didático, não um animal.
        </footer>
      </main>`;
  }

  // ---------------- jogo ----------------

  private play(missionId: string): void {
    const mission = MISSIONS.find(m => m.id === missionId) ?? null;
    const brain = store.get<Brain>(brainKey(this.ratId)) ?? freshBrain();
    const seed = Math.floor(Math.random() * 1e9);
    const sim = new Sim(seed, brain, learnOf(this.rat));
    this.sim = sim;
    this.mission = mission;
    this.startT = 0;
    this.done = false;
    this.score = 0;
    this.paused = false;
    this.seenEvents = 0;
    this.tipIndex = 0;
    this.lastTip = performance.now();
    this.tab = 'mente';
    if (mission) {
      sim.targets = mission.alvos;
      sim.setSchedule(mission.esquema);
      sim.setLightCycle(mission.luz);
    }

    const title = mission ? mission.titulo : 'Laboratório livre';
    const canClick = !mission || mission.cliqueManual;

    this.root.innerHTML = `
      <main class="game">
        <header class="bar">
          <button class="icon" data-action="home" aria-label="voltar">←</button>
          <div class="bar-title"><strong>${esc(title)}</strong><small>${esc(this.rat.name)}</small></div>
          <button class="icon" data-action="sound" aria-label="som">${this.sound.enabled ? '🔊' : '🔇'}</button>
        </header>

        <section class="goal card" data-role="goal">
          <div class="goal-text" data-role="goal-text"></div>
          <div class="progress"><i data-role="goal-bar"></i></div>
          <div class="tip" data-role="tip"></div>
        </section>

        <div class="stage">
          <canvas width="${W}" height="${H}" data-role="canvas" aria-label="caixa de Skinner"></canvas>
          <div class="hud">
            <span data-role="behavior"></span>
            <span data-role="clock"></span>
          </div>
        </div>

        <div class="controls">
          ${canClick ? `<button class="btn click" data-action="click">🔔 Clique + pelota</button>` : `<div class="auto" data-role="auto">⚙️ Alimentador automático: <b>${esc(sim.scheduleLabel())}</b></div>`}
          <div class="speed">
            <button class="icon" data-action="pause">${this.paused ? '▶' : '⏸'}</button>
            ${SPEEDS.map((s, i) => `<button class="pill ${i === this.speed ? 'on' : ''}" data-speed="${i}">${s}×</button>`).join('')}
            <span class="accel">⏩ acelerar</span>
          </div>
        </div>

        <nav class="tabs">
          <button data-tab="mente" class="on">🧠 Mente do rato</button>
          <button data-tab="registro">📈 Registro</button>
          ${mission ? '' : '<button data-tab="caixa">⚙️ Caixa</button>'}
        </nav>
        <section class="card panel" data-role="panel"></section>

        <div class="modal hidden" data-role="modal"></div>
      </main>`;

    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-role=canvas]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    this.renderer = new Renderer(ctx);
    canvas.addEventListener('pointerdown', () => this.studentClick());
    this.renderPanel();
    this.lastFrame = null;
    this.pending = 0;
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const sim = this.sim;
    if (!sim || !this.renderer) return;
    if (!this.paused && !this.done && this.lastFrame !== null) {
      // acumula o tempo real: um quadro (~16 ms) é menor que um passo da simulação (50 ms)
      this.pending += Math.min(0.25, (now - this.lastFrame) / 1000) * SPEEDS[this.speed];
      while (this.pending >= STEP) {
        sim.step(STEP);
        this.pending -= STEP;
      }
    }
    this.lastFrame = now;
    this.handleEvents(now);
    this.renderer.draw(sim, lookOf(this.rat), now);
    this.updateHud(now);
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
    const sim = this.sim;
    if (!sim || !this.renderer || this.done) return;
    if (this.mission && !this.mission.cliqueManual) {
      this.renderer.float('aqui quem reforça é o alimentador', '#64748b', performance.now(), sim);
      return;
    }
    const report = sim.click('aluno');
    this.seenEvents = sim.events.length;
    this.sound.click();
    this.sound.pellet();
    this.score += report.points;
    const { text, color } = describe(report, sim.targets.length > 0);
    this.renderer.float(text, color, performance.now(), sim);
  }

  private updateHud(now: number): void {
    const sim = this.sim;
    if (!sim) return;
    const q = <T extends Element>(sel: string): T | null => this.root.querySelector<T>(sel);
    const behavior = q<HTMLElement>('[data-role=behavior]');
    if (behavior) behavior.textContent = `🐭 ${LABEL[sim.behavior]}`;
    const clockEl = q<HTMLElement>('[data-role=clock]');
    if (clockEl) clockEl.textContent = `tempo de rato ${clock(sim.t - this.startT)}`;

    const goalText = q<HTMLElement>('[data-role=goal-text]');
    const goalBar = q<HTMLElement>('[data-role=goal-bar]');
    if (this.mission) {
      const p = this.mission.progresso(sim, this.startT);
      if (goalText) goalText.innerHTML = `<b>Meta:</b> ${esc(p.text)}${this.score ? ` · <b>${this.score} pts</b>` : ''}`;
      if (goalBar) goalBar.style.width = `${Math.min(100, (p.value / p.goal) * 100)}%`;
      if (!this.done && p.value >= p.goal) this.complete();
      if (now - this.lastTip > 8000) {
        this.tipIndex = (this.tipIndex + 1) % this.mission.dicas.length;
        this.lastTip = now;
      }
      const tip = q<HTMLElement>('[data-role=tip]');
      // missão automática com rato que nunca aprendeu a pressionar: nada vai acontecer
      const stuck = !this.mission.cliqueManual && sim.t - this.startT > 60 && sim.pressesSince(60) === 0;
      if (tip) {
        tip.textContent = stuck
          ? '⚠️ Ele não está pressionando. Se você recomeçou o rato, refaça a modelagem primeiro.'
          : `💡 ${this.mission.dicas[this.tipIndex]}`;
      }
    } else {
      if (goalText) goalText.innerHTML = `<b>Livre:</b> treine como quiser. ${this.score ? `<b>${this.score} pts</b>` : ''}`;
      if (goalBar) goalBar.style.width = '0%';
      const tip = q<HTMLElement>('[data-role=tip]');
      if (tip) tip.textContent = '💡 Use a aba Caixa para ligar o alimentador automático ou a luz.';
    }

    if (now - this.lastPanel > 300) {
      this.lastPanel = now;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    const sim = this.sim;
    const panel = this.root.querySelector<HTMLElement>('[data-role=panel]');
    if (!sim || !panel) return;
    if (this.tab === 'mente') {
      const w = sim.strengths();
      const total = CHOICES.reduce((sum, b) => sum + w[b], 0);
      const bars = CHOICES.map(b => {
        const pct = Math.round((w[b] / total) * 100);
        const hot = sim.targets.includes(b) ? 'target' : '';
        return `<div class="meter-row ${hot}"><span>${esc(LABEL[b])}</span><b><i style="width:${pct}%"></i></b><em>${pct}%</em></div>`;
      }).join('');
      panel.innerHTML = `
        <p class="note">Chance de cada comportamento agora. Reforço faz a barra crescer.</p>
        ${bars}
        <div class="meter-row special"><span>clique = comida</span><b><i style="width:${Math.round(sim.vMag * 100)}%"></i></b><em>${Math.round(sim.vMag * 100)}%</em></div>
        <div class="meter-row special"><span>fome</span><b><i style="width:${Math.round(sim.hunger * 100)}%"></i></b><em>${Math.round(sim.hunger * 100)}%</em></div>
        ${sim.lightCycle !== null ? `<p class="note">Luz ${sim.light ? 'acesa 💡' : 'apagada 🌑'}: as barras mostram o rato ${sim.light ? 'com' : 'sem'} luz.</p>` : ''}`;
    } else if (this.tab === 'registro') {
      if (!this.recordCanvas || !panel.contains(this.recordCanvas)) {
        panel.innerHTML = `<p class="note">Registro cumulativo: a linha sobe a cada pressão; marcas laranja são reforços.</p><canvas width="640" height="200" data-role="record"></canvas><p class="note" data-role="rate"></p>`;
        this.recordCanvas = panel.querySelector<HTMLCanvasElement>('[data-role=record]');
      }
      if (this.recordCanvas) drawRecord(this.recordCanvas, sim, this.startT);
      const rate = panel.querySelector<HTMLElement>('[data-role=rate]');
      if (rate) rate.textContent = `Último minuto: ${sim.pressesSince(60)} pressões.`;
    } else if (!panel.querySelector('[data-role=free]')) {
      const options = FREE_SCHEDULES.map(
        (s, i) => `<option value="${i}" ${JSON.stringify(s.spec) === JSON.stringify(sim.scheduleSpec) ? 'selected' : ''}>${s.label}</option>`,
      ).join('');
      panel.innerHTML = `
        <div data-role="free">
          <label>Alimentador automático<select data-field="schedule">${options}</select></label>
          <label>Luz de estímulo<select data-field="light">
            <option value="off" ${sim.lightCycle === null ? 'selected' : ''}>Sem luz</option>
            <option value="on" ${sim.lightCycle !== null ? 'selected' : ''}>Pisca a cada 20 s (reforço só com luz)</option>
          </select></label>
          <p class="note">Você ainda pode clicar à mão a qualquer momento.</p>
        </div>`;
    }
  }

  private complete(): void {
    const sim = this.sim;
    const mission = this.mission;
    if (!sim || !mission) return;
    this.done = true;
    const elapsed = sim.t - this.startT;
    const stars = elapsed <= mission.estrelas[0] ? 3 : elapsed <= mission.estrelas[1] ? 2 : 1;
    const before = this.progress.estrelas[mission.id] ?? 0;
    this.progress.estrelas[mission.id] = Math.max(before, stars);
    store.set(KEY_PROGRESS, this.progress);
    this.saveBrain();
    const index = MISSIONS.indexOf(mission);
    const next = MISSIONS[index + 1];
    const modal = this.root.querySelector<HTMLElement>('[data-role=modal]');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="card done">
        <div class="big-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <h2>Missão concluída!</h2>
        <p>${esc(mission.licao)}</p>
        <p class="note">Tempo de rato: ${clock(elapsed)}${this.score ? ` · ${this.score} pts` : ''}</p>
        <div class="row">
          <button class="btn ghost" data-action="home">Missões</button>
          ${next ? `<button class="btn primary" data-mission="${next.id}">Próxima: ${esc(next.titulo)}</button>` : '<button class="btn primary" data-mission="livre">Laboratório livre</button>'}
        </div>
      </div>`;
  }

  private saveBrain(): void {
    if (this.sim) store.set(brainKey(this.ratId), this.sim.snapshot());
  }

  private stop(): void {
    cancelAnimationFrame(this.rafId);
    if (this.sim) this.saveBrain();
    this.sim = null;
    this.renderer = null;
    this.recordCanvas = null;
  }

  // ---------------- eventos ----------------

  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-mission],[data-rat],[data-speed],[data-tab]');
    if (!el) return;
    if (el.dataset.mission) {
      this.stop();
      this.play(el.dataset.mission);
      return;
    }
    if (el.dataset.rat) {
      this.ratId = el.dataset.rat;
      store.set(KEY_RAT, this.ratId);
      this.home();
      return;
    }
    if (el.dataset.speed) {
      this.speed = Number(el.dataset.speed);
      this.root.querySelectorAll<HTMLElement>('[data-speed]').forEach(b => b.classList.toggle('on', b === el));
      return;
    }
    if (el.dataset.tab) {
      this.tab = el.dataset.tab as 'mente' | 'registro' | 'caixa';
      this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.classList.toggle('on', b === el));
      this.recordCanvas = null;
      const panel = this.root.querySelector<HTMLElement>('[data-role=panel]');
      if (panel) panel.innerHTML = '';
      this.renderPanel();
      return;
    }
    switch (el.dataset.action) {
      case 'click':
        this.studentClick();
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
      case 'intro-ok':
        store.set(KEY_INTRO, true);
        this.home();
        break;
      case 'new-rat':
        store.remove(brainKey(this.ratId));
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
  const what = LABEL[report.reinforced];
  if (report.quality === 'sem-efeito') return { text: 'clique ainda não significa comida', color: '#64748b' };
  if (!scoring) return { text: `reforçou: ${what}`, color: '#7c3aed' };
  if (report.points === 0) return { text: `ops, reforçou: ${what}`, color: '#ea580c' };
  if (report.quality === 'perfeito') return { text: `✨ perfeito! ${what} +${report.points}`, color: '#15803d' };
  if (report.quality === 'bom') return { text: `bom! ${what} +${report.points}`, color: '#0d9488' };
  return { text: `atrasado: ${what} +${report.points}`, color: '#d97706' };
}
