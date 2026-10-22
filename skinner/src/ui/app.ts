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
  { label: '10× acelerado', value: 10 },
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
  private durationMs = 15 * MIN;
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

    const lessonCards = [
      `<button class="lesson-card ${this.lessonId === '' ? 'selected' : ''}" data-lesson="">
         <strong>Laboratório livre</strong><span>Escolha o rato e as alavancas. Ninguém corrige você.</span>
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
        <div>
          <h1>Caixa Skinner</h1>
          <p class="tagline">Um laboratório de análise do comportamento, no seu bolso. Você opera a caixa; o rato aprende com as consequências, inclusive as suas.</p>
        </div>
        <span class="pill">⏩ tempo acelerado · 1 min real = 10 min de rato</span>
      </header>

      ${introSeen ? '' : `
      <section class="card intro">
        <h2>Como funciona</h2>
        <ol>
          <li><strong>Escolha uma aula</strong> ou solte-se no laboratório livre.</li>
          <li><strong>Mude o jeito de reforçar.</strong> Reforço é o que aumenta o comportamento. Você pode entregar reforço à mão ou configurar um esquema.</li>
          <li><strong>Observe o registro.</strong> Cada resposta aparece no gráfico. O que o rato faz logo antes do reforço fica mais provável.</li>
          <li><strong>Conclua o caderno.</strong> Ele compara o que você achava com o que de fato aconteceu.</li>
        </ol>
        <details>
          <summary>Glossário rápido</summary>
          <dl>
            <dt>Reforço</dt><dd>Algo que aparece depois do comportamento e faz ele se repetir mais.</dd>
            <dt>Esquema</dt><dd>A regra que decide quando o reforço aparece (ex.: FR 5 = a cada 5 respostas).</dd>
            <dt>Punição</dt><dd>Um bip abstrato que faz o comportamento diminuir.</dd>
            <dt>Extinção</dt><dd>Parar de reforçar. O comportamento tende a cair.</dd>
            <dt>Fome</dt><dd>Reforço perde valor quando o rato está saciado. A fome volta com o tempo.</dd>
            <dt>Luz S+ / S−</dt><dd>Luz acesa é a hora de reforçar; apagada, não reforçar.</dd>
          </dl>
        </details>
        <button class="primary" data-action="dismiss-intro">Entendi, bora</button>
      </section>`}

      <section class="card setup">
        <h2>Escolha a aula</h2>
        <div class="lesson-grid">${lessonCards}</div>
        ${lesson ? `<p class="objective">${esc(lesson.objetivo)}</p>` : ''}
        <div class="row">
          <label>Rato<select data-field="rat" ${lesson ? 'disabled' : ''}>${ratOptions}</select></label>
          ${lesson ? '' : `<label>Alavancas<select data-field="levers"><option value="1" ${this.leverCount === 1 ? 'selected' : ''}>1</option><option value="2" ${this.leverCount === 2 ? 'selected' : ''}>2</option></select></label>`}
          <label>Semente<input type="number" data-field="seed" value="${this.seed}" min="1" /></label>
        </div>
        <p class="hint">Mesma semente, mesmo rato: a turma pode comparar resultados.</p>
        ${memory ? `<p class="memory">🧠 ${esc(rat.name)} lembra das sessões anteriores. <button class="link" data-action="forget" data-rat="${rat.id}">esquecer</button></p>` : ''}
        <button class="primary big" data-action="start">Começar</button>
      </section>`;
  }

  private mountPlay(): void {
    const title = this.lesson ? this.lesson.titulo : 'Laboratório livre';
    const leverRows = this.levers
      .map((_, i) => {
        const left = this.levers.length === 1 ? 46 : 42 + i * 18;
        return `<div class="lever" data-lever="${i}" style="left:${left}%"><span>${i + 1}</span></div>`;
      })
      .join('');
    const deliver = this.levers
      .map((_, i) => `<button data-action="deliver" data-lever="${i}">+ reforço à mão (alavanca ${i + 1})</button>`)
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
            <span>Alavanca ${i + 1}: eu acho que está em</span>
            <select data-declare="kind" data-lever="${i}">${kindOptions('FR')}</select>
            <input type="number" data-declare="value" data-lever="${i}" value="5" min="0" step="any" />
          </div>`,
      )
      .join('');
    const acessorio = this.rat.visual.acessorio ? ` · ${esc(this.rat.visual.acessorio)}` : '';

    this.root.innerHTML = `
      <header class="hero compact">
        <div>
          <h1>Caixa Skinner</h1>
          <p class="tagline">${esc(title)} · ${esc(this.rat.name)}${acessorio} · semente ${this.seed}</p>
        </div>
        <span class="pill">⏩ tempo acelerado</span>
      </header>
      <section class="play">
        <div class="transport card">
          <button data-action="toggle">${this.playing ? '⏸ Pausar' : '▶ Continuar'}</button>
          ${SPEEDS.map((s, i) => `<button data-action="speed" data-speed="${i}" class="${i === this.speedIndex ? 'active' : ''}">${s.label}</button>`).join('')}
          <span class="clock" data-role="clock"></span>
          <button data-action="reset">Nova sessão</button>
        </div>
        ${this.lesson ? `<p class="card objective">${esc(this.lesson.objetivo)}</p>` : ''}
        <div class="grid">
          <div class="col">
            <div class="box card" data-role="box">
              <div class="lamp" data-role="lamp" title="luz de estímulo"></div>
              <div class="rat-slot" data-role="rat">${ratSvg(this.rat.visual, 'idle')}</div>
              ${leverRows}
              <div class="pellet" data-role="pellet"></div>
            </div>
            <p class="narr" data-role="narr"></p>
            <div class="counters card" data-role="counters"></div>
            <div class="deliver">${deliver}</div>
            <form class="card" data-form="schedule">
              <h3>Mudar o esquema</h3>
              <div class="row">
                <select name="lever">${leverOptions}</select>
                <select name="kind">${kindOptions('FR')}</select>
                <input name="value" type="number" value="5" min="0" step="any" aria-label="valor (n ou segundos)" />
                <button type="submit">Aplicar</button>
              </div>
              <p class="hint">FR e VR: número de respostas. Os demais: segundos.</p>
            </form>
            <form class="card" data-form="punish">
              <h3>Punição (bip abstrato)</h3>
              <div class="row">
                <select name="lever">${leverOptions}</select>
                <select name="kind">${kindOptions('EXT')}</select>
                <input name="value" type="number" value="4" min="0" step="any" aria-label="valor da punição" />
                <button type="submit">Aplicar</button>
              </div>
              <p class="hint">Punição vem depois de respostas. EXT desliga.</p>
            </form>
            <form class="card" data-form="note">
              <h3>Anotação</h3>
              <div class="row"><input name="text" type="text" placeholder="o que você está testando agora?" /><button type="submit">Anotar</button></div>
            </form>
            <ul class="notes" data-role="notes"></ul>
          </div>
          <div class="col">
            <div class="card" data-role="missao"></div>
            <div class="record card" data-role="record"></div>
            <h3>O que o registro mostra</h3>
            <ul class="feedback card" data-role="feedback"></ul>
            <form class="card" data-form="caderno">
              <h3>Caderno de laboratório</h3>
              <p class="hint">Escreva a hipótese antes de mexer no esquema. Ao concluir, o registro é comparado com ela.</p>
              ${declared}
              ${questions}
              <button type="submit" class="primary">Concluir e comparar</button>
            </form>
            <div class="result card" data-role="result"></div>
            <button data-action="export">Exportar CSV</button>
          </div>
        </div>
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
    if (clockEl) clockEl.textContent = `${clock(now)} / ${clock(this.durationMs)}${session.ended ? ' · encerrada' : ''}`;

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

    const box = q<HTMLElement>('[data-role=box]');
    box?.classList.toggle('punished', lastPunishment !== undefined && now - lastPunishment.t < 300);
    const lamp = q<HTMLElement>('[data-role=lamp]');
    if (lamp) {
      lamp.classList.toggle('on', this.lesson?.luz ? session.light : false);
      lamp.classList.toggle('has-stimulus', this.lesson?.luz !== undefined);
    }
    q<HTMLElement>('[data-role=pellet]')?.classList.toggle('on', lastReinforcer !== undefined && now - lastReinforcer.t < 900);

    const narr = q<HTMLElement>('[data-role=narr]');
    if (narr) {
      const manual = lastReinforcer?.source === 'manual';
      const mechanical = lastReinforcer
        ? `Reforço ${manual ? 'à mão' : 'automático'} na alavanca ${(lastReinforcer.lever ?? 0) + 1}, aos ${clock(lastReinforcer.t)}.`
        : '';
      const punishedRecently = lastPunishment !== undefined && now - lastPunishment.t < 2000;
      const flavour = session.ended
        ? narrate('fim', now)
        : punishedRecently
          ? narrate('punicao', lastPunishment.t)
          : lastReinforcer
            ? narrate(manual ? 'reforco_manual' : 'reforco_auto', lastReinforcer.t)
            : narrate('sem_reforco', now);
      narr.innerHTML = `${esc(mechanical)} <em>${esc(flavour)}</em>`;
    }

    const counters = q<HTMLElement>('[data-role=counters]');
    if (counters) {
      const hunger = Math.round(session.hunger * 100);
      const stimulusLine = this.lesson?.luz
        ? `<div><strong>Luz</strong> · ${session.light ? 'acesa: reforço disponível' : 'apagada: sem reforço'}</div>`
        : '';
      const behaviorLine = ratState
        ? `<div><strong>Rato</strong> · ${esc(BEHAVIOR_LABEL[ratState.behavior as keyof typeof BEHAVIOR_LABEL])}</div>`
        : '';
      const hungerLine = `<div class="hunger"><strong>Fome</strong><span class="meter"><i style="width:${hunger}%"></i></span> ${hunger}%</div>`;
      counters.innerHTML =
        behaviorLine +
        stimulusLine +
        hungerLine +
        this.levers
          .map((_, i) => {
            const punish = lastPunishSpec(log, i);
            const punishText = punish ? ` · punição ${esc(punish)}` : '';
            return `<div><strong>Alavanca ${i + 1}</strong> · ${esc(lastSpec(log, i))}${punishText} · respostas ${log.ofType('response', i).length} · reforços ${log.ofType('reinforcer', i).length}</div>`;
          })
          .join('');
    }

    const missao = q<HTMLElement>('[data-role=missao]');
    if (missao) {
      if (this.lesson?.criterio) {
        const progresso = avaliar(log, this.lesson.criterio);
        missao.className = `card mission ${progresso.ok ? 'done' : ''}`;
        missao.innerHTML = `<h3>${progresso.ok ? '🎉 Missão concluída' : 'Missão'}</h3><p>${esc(progresso.texto)}</p>`;
      } else {
        missao.className = 'card mission';
        missao.innerHTML = '<h3>Laboratório livre</h3><p class="hint">Sem missão. Explore à vontade.</p>';
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
        .map(e => `<li><span class="when">${clock(e.t)}</span> ${esc(e.text ?? '')}</li>`)
        .join('');
    }

    const toggle = q<HTMLButtonElement>('[data-action=toggle]');
    if (toggle) toggle.textContent = this.playing ? '⏸ Pausar' : '▶ Continuar';
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
    } else if (kind === 'note') {
      const input = form.querySelector<HTMLInputElement>('input[name=text]');
      const text = input?.value.trim() ?? '';
      if (text && this.session) {
        this.session.act({ kind: 'note', text });
        if (input) input.value = '';
        this.update();
      }
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
    if (narr) narr.innerHTML = `<em>${esc(line)}</em>`;
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
      const evidence = result.evidence.map(s => `<li>${esc(s)}</li>`).join('');
      return `
        <div class="lever-result">
          <h4>Alavanca ${i + 1}: ${esc(RESULT_TEXT[result.label] ?? result.label)}</h4>
          ${verdict ? `<p class="${verdict.match ? 'ok' : 'miss'}">${esc(verdict.text)}</p>` : ''}
          <ul>${evidence}</ul>
        </div>`;
    });

    const checks = methodChecks(log);
    const done = checks.filter(c => c.ok).length;
    const list = checks.map(c => `<li class="${c.ok ? 'ok' : 'miss'}">${c.ok ? '✔' : '✖'} ${esc(c.text)}</li>`).join('');
    const result = this.root.querySelector<HTMLElement>('[data-role=result]');
    if (result) {
      result.innerHTML = `<h3>Comparação</h3>${parts.join('')}<h3>Práticas de método: ${done} de ${checks.length}</h3><ul class="checks">${list}</ul>`;
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

/** Punição atualmente em vigor na alavanca, se houver. */
function lastPunishSpec(log: EventLog, lever: number): string | undefined {
  const sets = log.ofType('schedule_set', lever).filter(e => e.text === 'punição' || e.text === 'punição inicial');
  const last = sets[sets.length - 1];
  return last && last.spec !== 'EXT' ? last.spec : undefined;
}
