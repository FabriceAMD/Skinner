import {
  avaliar,
  BEHAVIOR_LABEL,
  classify,
  compareIntent,
  describeSession,
  inputFromLog,
  methodChecks,
  Session,
  type EventLog,
  type LogEvent,
  type RatMemory,
  type ScheduleSpec,
  type StudentCommand,
} from '../core';
import { LESSONS, RATS, findRat, narrate, type Lesson, type RatEntry } from '../content';
import { ratSvg } from './rat-svg';
import { recordSvg } from './record';

const MIN = 60_000;
/** Tempo acelerado é o padrão: a aula inteira cabe em poucos minutos reais. */
const SPEEDS = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '60×', value: 60 },
];
const DEFAULT_SPEED = 1;
const KINDS: ScheduleSpec['kind'][] = ['FR', 'VR', 'FI', 'VI', 'DRL', 'DRO', 'EXT'];
const KIND_LABEL: Record<ScheduleSpec['kind'], string> = {
  FR: 'FR · razão fixa',
  VR: 'VR · razão variável',
  FI: 'FI · intervalo fixo',
  VI: 'VI · intervalo variável',
  DRL: 'DRL · pausa mínima',
  DRO: 'DRO · sem resposta',
  EXT: 'EXT · extinção',
};
const RESULT_TEXT: Record<string, string> = {
  sem_dados: 'sem dados',
  EXT: 'extinção (EXT)',
  DRO: 'DRO',
  DRL: 'DRL',
  FR: 'FR',
  FI: 'FI',
  VARIAVEL: 'VR ou VI (o registro sozinho não separa os dois)',
  indeterminado: 'indeterminado',
};

const INTRO_KEY = 'caixa-skinner:intro-visto';
const memKey = (ratId: string): string => `caixa-skinner:memoria:${ratId}`;

/** localStorage pode estar bloqueado (aba privada, configurações do navegador). Nada aqui pode quebrar a tela. */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* sem memória persistente: o jogo continua */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* idem */
    }
  },
};

function loadMemory(ratId: string): RatMemory | null {
  const raw = store.get(memKey(ratId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RatMemory;
  } catch {
    return null;
  }
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Converte o valor digitado no formulário ou no caderno no esquema correspondente. */
function specFrom(kind: ScheduleSpec['kind'], value: number): ScheduleSpec {
  if (kind === 'EXT') return { kind };
  if (kind === 'FR' || kind === 'VR') return { kind, n: Math.max(1, Math.round(value)) };
  return { kind, ms: Math.max(100, Math.round(value * 1000)) };
}

function kindOptions(selected: ScheduleSpec['kind']): string {
  return KINDS.map(k => `<option value="${k}" ${k === selected ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('');
}

export function startApp(root: HTMLElement): void {
  new App(root).mountSetup();
}

class App {
  private lessonId = '';
  private ratId = RATS[0].id;
  private leverCount = 1;
  private seed = 7;
  private session: Session | null = null;
  private lesson: Lesson | null = null;
  private rat: RatEntry = RATS[0];
  private levers: ScheduleSpec[] = [];
  private durationMs = 10 * MIN;
  private speedIndex = DEFAULT_SPEED;
  private playing = true;
  private lastTs: number | null = null;
  private lastUi = 0;
  private lastFeedback = 0;
  private rafId = 0;
  private savedEnd = false;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', e => this.onClick(e));
    root.addEventListener('change', e => this.onChange(e));
    root.addEventListener('submit', e => this.onSubmit(e));
  }

  // ---------- tela inicial ----------

  mountSetup(): void {
    this.stopLoop();
    this.session = null;
    const lesson = this.lessonId ? LESSONS.find(l => l.id === this.lessonId) : undefined;
    const rat = findRat(lesson ? lesson.rato : this.ratId);
    const memory = loadMemory(rat.id);
    const introSeen = store.get(INTRO_KEY) === '1';

    const cards = [
      `<button class="lesson-card ${this.lessonId === '' ? 'selected' : ''}" data-lesson="">
         <strong>Livre</strong><span>Sem missão. Explore.</span>
       </button>`,
      ...LESSONS.map(
        l => `<button class="lesson-card ${this.lessonId === l.id ? 'selected' : ''}" data-lesson="${l.id}">
           <strong>${esc(l.titulo)}</strong><span>${l.duracaoMin} min · ${esc(findRat(l.rato).name)}</span>
         </button>`,
      ),
    ].join('');

    const ratOptions = RATS.map(
      r => `<option value="${r.id}" ${r.id === rat.id ? 'selected' : ''}>${esc(r.name)} · ${esc(r.papel)}</option>`,
    ).join('');

    this.root.innerHTML = `
      <header class="hero">
        <h1>Caixa Skinner</h1>
        <p class="tagline">Você opera a caixa. O rato aprende com as consequências, inclusive as suas.</p>
        <span class="pill">⏩ tempo acelerado</span>
      </header>

      ${introSeen ? '' : `
      <section class="card intro">
        <p><strong>Em 3 passos:</strong></p>
        <ol>
          <li>Escolha uma aula.</li>
          <li>Reforce o que quer ver mais: use o botão de reforço ou um esquema.</li>
          <li>Veja o registro. Cada resposta aparece no gráfico.</li>
        </ol>
        <details>
          <summary>O que significam os termos?</summary>
          <dl>
            <dt>Reforço</dt><dd>Algo que aparece depois do comportamento e faz ele se repetir mais.</dd>
            <dt>Esquema</dt><dd>A regra de quando o reforço aparece. FR 5 = a cada 5 respostas.</dd>
            <dt>Punição</dt><dd>Um bip que faz o comportamento diminuir.</dd>
            <dt>Extinção</dt><dd>Parar de reforçar. O comportamento tende a cair.</dd>
            <dt>Fome</dt><dd>Reforço perde valor quando o rato está saciado.</dd>
            <dt>Luz</dt><dd>Luz acesa: reforço disponível. Apagada: não reforce.</dd>
          </dl>
        </details>
        <button class="primary" data-action="dismiss-intro">Entendi</button>
      </section>`}

      <section class="card setup">
        <h2>Aula</h2>
        <div class="lesson-grid">${cards}</div>
        ${lesson ? `<p class="objective">${esc(lesson.objetivo)}</p>` : ''}
        <div class="row">
          <label>Rato<select data-field="rat" ${lesson ? 'disabled' : ''}>${ratOptions}</select></label>
          ${lesson ? '' : `<label>Alavancas<select data-field="levers"><option value="1" ${this.leverCount === 1 ? 'selected' : ''}>1</option><option value="2" ${this.leverCount === 2 ? 'selected' : ''}>2</option></select></label>`}
          <label>Semente<input type="number" data-field="seed" value="${this.seed}" min="1" /></label>
        </div>
        ${memory ? `<p class="memory">🧠 ${esc(rat.name)} lembra de sessões anteriores. <button class="link" data-action="forget" data-rat="${rat.id}">esquecer</button></p>` : ''}
        <button class="primary big" data-action="start">Começar</button>
      </section>`;
  }

  private mountPlay(): void {
    const title = this.lesson ? this.lesson.titulo : 'Livre';
    const leverRows = this.levers
      .map((_, i) => {
        const left = this.levers.length === 1 ? 80 : 74 + i * 16;
        return `<div class="lever" data-lever="${i}" style="left:${left}%"><span>${i + 1}</span></div>`;
      })
      .join('');
    const deliver = this.levers
      .map((_, i) => `<button class="reward" data-action="deliver" data-lever="${i}">Reforçar${this.levers.length > 1 ? ` (${i + 1})` : ''}</button>`)
      .join('');
    const leverOptions = this.levers.map((_, i) => `<option value="${i}">Alavanca ${i + 1}</option>`).join('');
    const questions = this.lesson
      ? this.lesson.perguntas
          .map((q, i) => `<label class="q">${esc(q)}<textarea data-question="${i}" rows="2"></textarea></label>`)
          .join('')
      : '';
    const declared = this.levers
      .map(
        (_, i) => `
          <div class="declare">
            <span>Alavanca ${i + 1}: acho que está em</span>
            <select data-declare="kind" data-lever="${i}">${kindOptions('FR')}</select>
            <input type="number" data-declare="value" data-lever="${i}" value="5" min="0" step="any" />
          </div>`,
      )
      .join('');

    this.root.innerHTML = `
      <header class="topbar">
        <div><strong>Caixa Skinner</strong> · ${esc(title)}</div>
        <div class="clock" data-role="clock"></div>
      </header>

      <section class="play">
        <div class="transport">
          <button data-action="toggle">${this.playing ? '⏸' : '▶'}</button>
          ${SPEEDS.map((s, i) => `<button data-action="speed" data-speed="${i}" class="${i === this.speedIndex ? 'active' : ''}">${s.label}</button>`).join('')}
          <button class="ghost" data-action="reset">Nova sessão</button>
        </div>

        <div class="chips" data-role="chips"></div>
        <div class="guide" data-role="guide"></div>

        <div class="card box" data-role="box">
          <div class="lamp" data-role="lamp" title="luz"></div>
          <div class="rat-slot" data-role="rat">${ratSvg(this.rat.visual, 'idle')}</div>
          ${leverRows}
          <div class="pellet" data-role="pellet"></div>
        </div>
        <p class="narr" data-role="narr"></p>
        <div class="deliver">${deliver}</div>

        <div class="card mission" data-role="missao"></div>

        <details class="panel" open>
          <summary>Registro</summary>
          <div class="record" data-role="record"></div>
          <ul class="notes" data-role="notes"></ul>
          <ul class="feedback" data-role="feedback"></ul>
        </details>

        <details class="panel">
          <summary>Mudar esquema ou punição</summary>
          <form data-form="schedule">
            <h3>Esquema</h3>
            <div class="row">
              <select name="lever">${leverOptions}</select>
              <select name="kind">${kindOptions('FR')}</select>
              <input name="value" type="number" value="5" min="0" step="any" aria-label="valor" />
              <button type="submit">Aplicar</button>
            </div>
            <p class="hint">FR e VR: número de respostas. Os demais: segundos.</p>
          </form>
          <form data-form="punish">
            <h3>Punição (bip)</h3>
            <div class="row">
              <select name="lever">${leverOptions}</select>
              <select name="kind">${kindOptions('EXT')}</select>
              <input name="value" type="number" value="4" min="0" step="any" aria-label="valor da punição" />
              <button type="submit">Aplicar</button>
            </div>
          </form>
        </details>

        <details class="panel">
          <summary>Caderno de laboratório</summary>
          <form data-form="caderno">
            <p class="hint">Antes de mexer, escreva o que você acha que está em vigor. Ao concluir, comparamos com o registro.</p>
            ${declared}
            ${questions}
            <button type="submit" class="primary">Concluir e comparar</button>
          </form>
          <div class="result" data-role="result"></div>
        </details>

        <p class="footer"><button class="ghost" data-action="export">Exportar CSV</button></p>
      </section>`;
    this.update();
  }

  // ---------- ciclo de tempo ----------

  private loop = (ts: number): void => {
    const session = this.session;
    if (!session) return;
    if (!session.ended) {
      if (this.playing && this.lastTs !== null) {
        session.runTo(session.time + (ts - this.lastTs) * SPEEDS[this.speedIndex].value);
      }
      if (session.time >= this.durationMs) {
        session.finish();
        this.playing = false;
      }
      this.lastTs = this.playing ? ts : null;
    }
    if (ts - this.lastUi > 250) {
      this.lastUi = ts;
      this.update();
    }
    if (session.ended && !this.savedEnd) {
      this.savedEnd = true;
      this.saveMemory();
    }
    if (!session.ended) this.rafId = requestAnimationFrame(this.loop);
  };

  private startLoop(): void {
    cancelAnimationFrame(this.rafId);
    this.lastTs = null;
    this.savedEnd = false;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.rafId);
    this.session = null;
  }

  private saveMemory(): void {
    if (!this.session) return;
    store.set(memKey(this.rat.id), JSON.stringify(this.session.memory));
  }

  // ---------- atualização da tela ----------

  private update(): void {
    const session = this.session;
    if (!session) return;
    const log = session.log;
    const now = session.time;
    const q = <T extends Element>(sel: string): T | null => this.root.querySelector<T>(sel);

    const clockEl = q<HTMLElement>('[data-role=clock]');
    if (clockEl) clockEl.textContent = `${clock(now)} / ${clock(this.durationMs)}${session.ended ? ' · fim' : ''}`;

    const lastResponse = lastEvent(log, 'response');
    const lastReinforcer = lastEvent(log, 'reinforcer');
    const lastPunishment = lastEvent(log, 'punishment');
    const ratState = session.ratState;

    const ratSlot = q<HTMLElement>('[data-role=rat]');
    if (ratSlot) {
      if (ratState) ratSlot.style.left = `${6 + ratState.pos * 36}%`;
      ratSlot.classList.toggle('press', lastResponse !== undefined && now - lastResponse.t < 250);
      ratSlot.classList.toggle('eat', lastReinforcer !== undefined && now - lastReinforcer.t < 900);
    }
    this.root.querySelectorAll<HTMLElement>('.lever[data-lever]').forEach(el => {
      const lever = Number(el.dataset.lever);
      el.classList.toggle('down', lastResponse?.lever === lever && now - lastResponse.t < 200);
    });
    q<HTMLElement>('[data-role=box]')?.classList.toggle('punished', lastPunishment !== undefined && now - lastPunishment.t < 300);
    const lamp = q<HTMLElement>('[data-role=lamp]');
    if (lamp) {
      lamp.style.display = this.lesson?.luz ? '' : 'none';
      lamp.classList.toggle('on', session.light);
    }
    q<HTMLElement>('[data-role=pellet]')?.classList.toggle('on', lastReinforcer !== undefined && now - lastReinforcer.t < 900);

    // fichas de status: uma linha, sempre no mesmo lugar
    const chips = q<HTMLElement>('[data-role=chips]');
    if (chips) {
      const hunger = Math.round(session.hunger * 100);
      const behavior = ratState ? BEHAVIOR_LABEL[ratState.behavior as keyof typeof BEHAVIOR_LABEL] : '';
      const luzChip = this.lesson?.luz ? `<span class="chip ${session.light ? 'light-on' : 'light-off'}">${session.light ? '💡 luz acesa' : '🌑 luz apagada'}</span>` : '';
      const schedules = this.levers.map((_, i) => `<span class="chip">Alav. ${i + 1}: ${esc(lastSpec(log, i))}</span>`).join('');
      chips.innerHTML = `
        <span class="chip">🐭 ${esc(behavior)}</span>
        ${luzChip}
        <span class="chip hunger">🍽 <i style="width:${Math.round(hunger * 0.46)}px"></i></span>
        ${schedules}`;
    }

    const guide = q<HTMLElement>('[data-role=guide]');
    if (guide) guide.textContent = this.guideLine(session);

    const narr = q<HTMLElement>('[data-role=narr]');
    if (narr) {
      const manual = lastReinforcer?.source === 'manual';
      const punishedRecently = lastPunishment !== undefined && now - lastPunishment.t < 2000;
      narr.textContent = session.ended
        ? narrate('fim', now)
        : punishedRecently
          ? narrate('punicao', lastPunishment.t)
          : lastReinforcer
            ? narrate(manual ? 'reforco_manual' : 'reforco_auto', lastReinforcer.t)
            : narrate('sem_reforco', now);
    }

    const missao = q<HTMLElement>('[data-role=missao]');
    if (missao) {
      if (this.lesson?.criterio) {
        const progresso = avaliar(log, this.lesson.criterio);
        missao.className = `card mission ${progresso.ok ? 'done' : ''}`;
        missao.innerHTML = `<strong>${progresso.ok ? '🎉 Missão concluída' : 'Missão'}</strong><span>${esc(progresso.texto)}</span>`;
      } else {
        missao.className = 'card mission';
        missao.innerHTML = '<strong>Livre</strong><span>Sem missão. Explore à vontade.</span>';
      }
    }

    const record = q<HTMLElement>('[data-role=record]');
    if (record) record.innerHTML = recordSvg(log, this.durationMs, now);

    if (now - this.lastFeedback > 2000 || session.ended) {
      this.lastFeedback = now;
      const feedback = q<HTMLElement>('[data-role=feedback]');
      if (feedback) {
        feedback.innerHTML = describeSession(log, Math.min(now, this.durationMs))
          .map(s => `<li>${esc(s)}</li>`)
          .join('');
      }
    }

    const notes = q<HTMLElement>('[data-role=notes]');
    if (notes) {
      notes.innerHTML = log
        .ofType('note')
        .map(e => `<li class="${e.auto ? 'auto' : ''}"><span class="when">${clock(e.t)}</span> ${esc(e.text ?? '')}</li>`)
        .join('');
    }

    const toggle = q<HTMLButtonElement>('[data-action=toggle]');
    if (toggle) toggle.textContent = this.playing ? '⏸' : '▶';
  }

  /** Uma frase só, dizendo o que fazer agora. Muda conforme a aula e o estado da caixa. */
  private guideLine(session: Session): string {
    if (session.ended) return 'Sessão encerrada. Veja o registro e conclua o caderno.';
    const state = session.ratState;
    if (this.lesson?.luz) {
      return session.light
        ? 'Luz acesa: o reforço funciona agora. Reforce quando ele responder.'
        : 'Luz apagada: não reforce agora. Observe.';
    }
    if (this.lesson?.repertorio && state) {
      if (state.behavior === 'press') return 'Ele pressionou a barra! Reforce agora.';
      if (state.behavior === 'touch') return 'Ele tocou a barra. Reforce já.';
      if (state.behavior === 'approach' || state.pos > 0.4) return 'Ele está indo até a barra. Reforce enquanto se aproxima.';
      return 'Espere ele se mexer e reforce o que ele fizer.';
    }
    const reinforcers = session.log.ofType('reinforcer').length;
    if (reinforcers === 0) return 'Ainda sem reforço. Reforce quando achar o momento certo.';
    return 'Observe o registro. Mude o esquema quando quiser testar outra coisa.';
  }

  // ---------- eventos ----------

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-lesson]');
    if (!target) return;
    if (target.dataset.lesson !== undefined) {
      this.lessonId = target.dataset.lesson;
      const lesson = LESSONS.find(l => l.id === this.lessonId);
      if (lesson) this.ratId = lesson.rato;
      this.mountSetup();
      return;
    }
    const action = target.dataset.action;
    if (action === 'start') this.start();
    else if (action === 'dismiss-intro') {
      store.set(INTRO_KEY, '1');
      this.mountSetup();
    } else if (action === 'forget') {
      store.remove(memKey(target.dataset.rat ?? this.ratId));
      this.mountSetup();
    } else if (action === 'toggle') {
      this.playing = !this.playing;
      this.update();
    } else if (action === 'speed') {
      this.speedIndex = Number(target.dataset.speed);
      this.root.querySelectorAll<HTMLElement>('[data-action=speed]').forEach(b => b.classList.toggle('active', b === target));
    } else if (action === 'deliver') {
      this.act({ kind: 'deliver', lever: Number(target.dataset.lever) });
    } else if (action === 'reset') {
      this.saveMemory();
      this.mountSetup();
    } else if (action === 'export') {
      this.exportCsv();
    }
  }

  private onChange(e: Event): void {
    const field = (e.target as HTMLElement).dataset.field;
    if (!field) return;
    const value = (e.target as HTMLInputElement | HTMLSelectElement).value;
    if (field === 'rat') this.ratId = value;
    else if (field === 'levers') this.leverCount = Number(value);
    else if (field === 'seed') this.seed = Math.max(1, Math.floor(Number(value) || 1));
  }

  private onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement;
    const kind = form.dataset.form;
    e.preventDefault();
    if (kind === 'schedule') {
      const data = new FormData(form);
      const spec = specFrom(String(data.get('kind')) as ScheduleSpec['kind'], Number(data.get('value')));
      this.act({ kind: 'set_schedule', lever: Number(data.get('lever')), spec });
    } else if (kind === 'punish') {
      const data = new FormData(form);
      const spec = specFrom(String(data.get('kind')) as ScheduleSpec['kind'], Number(data.get('value')));
      this.act({ kind: 'set_punish', lever: Number(data.get('lever')), spec });
    } else if (kind === 'caderno') {
      this.conclude(form);
    }
  }

  private act(command: StudentCommand): void {
    if (!this.session || this.session.ended) return;
    this.session.act(command);
    if (command.kind === 'set_schedule') this.flashNarration(narrate('mudanca_esquema', this.session.time));
    this.update();
  }

  private flashNarration(line: string): void {
    const narr = this.root.querySelector<HTMLElement>('[data-role=narr]');
    if (narr) narr.textContent = line;
  }

  private start(): void {
    this.lesson = this.lessonId ? LESSONS.find(l => l.id === this.lessonId) ?? null : null;
    this.rat = findRat(this.lesson ? this.lesson.rato : this.ratId);
    this.levers = this.lesson
      ? this.lesson.alavancas
      : Array.from({ length: this.leverCount }, () => ({ kind: 'FR', n: 5 }) as ScheduleSpec);
    this.durationMs = (this.lesson ? this.lesson.duracaoMin : 10) * MIN;
    this.playing = true;
    this.speedIndex = DEFAULT_SPEED;
    this.session = new Session({
      seed: this.seed,
      durationMs: this.durationMs,
      rat: { ...this.rat, repertorio: this.lesson?.repertorio ?? false },
      levers: this.levers,
      curriculum: this.lesson?.curriculo,
      punish: this.lesson?.punicao,
      luz: this.lesson?.luz,
      memoria: loadMemory(this.rat.id) ?? undefined,
    });
    this.mountPlay();
    this.startLoop();
  }

  private conclude(form: HTMLFormElement): void {
    if (!this.session) return;
    const log = this.session.log;
    form.querySelectorAll<HTMLTextAreaElement>('textarea[data-question]').forEach(area => {
      const question = this.lesson?.perguntas[Number(area.dataset.question)] ?? '';
      if (area.value.trim()) this.session?.act({ kind: 'note', text: `${question} ${area.value.trim()}` });
    });

    const parts = this.levers.map((_, i) => {
      const kindEl = form.querySelector<HTMLSelectElement>(`select[data-declare=kind][data-lever="${i}"]`);
      const valueEl = form.querySelector<HTMLInputElement>(`input[data-declare=value][data-lever="${i}"]`);
      const declared = kindEl && valueEl ? specFrom(kindEl.value as ScheduleSpec['kind'], Number(valueEl.value)) : null;
      const result = classify(inputFromLog(log, i));
      const verdict = declared ? compareIntent(declared, result) : null;
      return `
        <div class="lever-result">
          <h4>Alavanca ${i + 1}: ${esc(RESULT_TEXT[result.label] ?? result.label)}</h4>
          ${verdict ? `<p class="${verdict.match ? 'ok' : 'miss'}">${esc(verdict.text)}</p>` : ''}
        </div>`;
    });

    const checks = methodChecks(log);
    const done = checks.filter(c => c.ok).length;
    const list = checks.map(c => `<li class="${c.ok ? 'ok' : 'miss'}">${c.ok ? '✔' : '✖'} ${esc(c.text)}</li>`).join('');
    const result = this.root.querySelector<HTMLElement>('[data-role=result]');
    if (result) {
      result.innerHTML = `<h3>Comparação</h3>${parts.join('')}<h3>Práticas: ${done} de ${checks.length}</h3><ul class="checks">${list}</ul>`;
    }
    this.update();
  }

  private exportCsv(): void {
    if (!this.session) return;
    const blob = new Blob([this.session.log.toCSV()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `caixa-skinner-semente-${this.seed}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Último evento de um tipo, buscando de trás para frente. */
function lastEvent(log: EventLog, type: LogEvent['type']): LogEvent | undefined {
  const all = log.all;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].type === type) return all[i];
  }
  return undefined;
}

/** Esquema atualmente em vigor na alavanca. */
function lastSpec(log: EventLog, lever: number): string {
  const sets = log.ofType('schedule_set', lever).filter(e => e.text === undefined || e.text === 'inicial');
  return sets[sets.length - 1]?.spec ?? '—';
}
