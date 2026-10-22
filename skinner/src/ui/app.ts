import {
  classify,
  compareIntent,
  describeSession,
  inputFromLog,
  Session,
  type EventLog,
  type LogEvent,
  type ScheduleSpec,
  type StudentCommand,
} from '../core';
import { LESSONS, RATS, findRat, narrate, type Lesson, type RatEntry } from '../content';
import { ratSvg } from './rat-svg';
import { recordSvg } from './record';

const MIN = 60_000;
const SPEEDS = [1, 10, 60];
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

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const clock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Converte o valor digitado no caderno ou no formulário no esquema correspondente. */
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
  private durationMs = 20 * MIN;
  private speedIndex = 0;
  private playing = true;
  private lastTs: number | null = null;
  private lastUi = 0;
  private lastFeedback = 0;
  private rafId = 0;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', e => this.onClick(e));
    root.addEventListener('change', e => this.onChange(e));
    root.addEventListener('submit', e => this.onSubmit(e));
  }

  // ---------- vistas ----------

  mountSetup(): void {
    this.stopLoop();
    this.session = null;
    const lessonOptions = [`<option value="">Aula livre</option>`]
      .concat(LESSONS.map(l => `<option value="${l.id}" ${l.id === this.lessonId ? 'selected' : ''}>${esc(l.titulo)}</option>`))
      .join('');
    const ratOptions = RATS.map(r => `<option value="${r.id}" ${r.id === this.ratId ? 'selected' : ''}>${esc(r.name)} · ${esc(r.papel)}</option>`).join('');
    const lesson = this.lessonId ? LESSONS.find(l => l.id === this.lessonId) : undefined;
    const intro = lesson
      ? `<p class="objective">${esc(lesson.objetivo)}</p>`
      : `<p class="objective">Aula livre: escolha um rato, uma ou duas alavancas e observe. Nada é corrigido; tudo é registrado.</p>`;

    this.root.innerHTML = `
      <header class="top">
        <h1>Caixa Skinner</h1>
        <p class="tag">Um laboratório com funcionários. Todo comportamento aqui, inclusive o seu, fica registrado.</p>
      </header>
      <section class="setup card">
        <h2>Preparar a caixa</h2>
        ${intro}
        <div class="row">
          <label>Aula<select data-field="lesson">${lessonOptions}</select></label>
          <label>Rato<select data-field="rat" ${lesson ? 'disabled' : ''}>${ratOptions}</select></label>
          ${lesson ? '' : `<label>Alavancas<select data-field="levers"><option value="1" ${this.leverCount === 1 ? 'selected' : ''}>1</option><option value="2" ${this.leverCount === 2 ? 'selected' : ''}>2</option></select></label>`}
          <label>Semente<input type="number" data-field="seed" value="${this.seed}" min="1" /></label>
        </div>
        <p class="hint">A mesma semente gera o mesmo rato, então a turma pode comparar resultados.</p>
        <button class="primary" data-action="start">Começar sessão</button>
      </section>`;
  }

  private mountPlay(): void {
    const title = this.lesson ? this.lesson.titulo : 'Aula livre';
    const leverRows = this.levers
      .map((_, i) => {
        const left = this.levers.length === 1 ? 44 : 40 + i * 20;
        return `<div class="lever" data-lever="${i}" style="left:${left}%"><span>${i + 1}</span></div>`;
      })
      .join('');
    const deliver = this.levers
      .map((_, i) => `<button data-action="deliver" data-lever="${i}">Entregar reforço à mão (alavanca ${i + 1})</button>`)
      .join('');
    const scheduleLever = this.levers.map((_, i) => `<option value="${i}">Alavanca ${i + 1}</option>`).join('');
    const questions = this.lesson
      ? this.lesson.perguntas
          .map((q, i) => `<label class="q">${esc(q)}<textarea data-question="${i}" rows="2"></textarea></label>`)
          .join('')
      : '';
    const declared = this.levers
      .map(
        (_spec, i) => `
          <div class="declare">
            <span>Alavanca ${i + 1}: eu acho que está em</span>
            <select data-declare="kind" data-lever="${i}">${kindOptions('FR')}</select>
            <input type="number" data-declare="value" data-lever="${i}" value="5" min="0" step="any" />
          </div>`,
      )
      .join('');

    this.root.innerHTML = `
      <header class="top">
        <h1>Caixa Skinner</h1>
        <p class="tag">${esc(title)} · rato: ${esc(this.rat.name)} · semente ${this.seed}</p>
      </header>
      <section class="play">
        ${this.lesson ? `<p class="card objective">${esc(this.lesson.objetivo)}</p>` : ''}
        <div class="transport card">
          <button data-action="toggle">${this.playing ? 'Pausar' : 'Continuar'}</button>
          ${SPEEDS.map((s, i) => `<button data-action="speed" data-speed="${i}" class="${i === this.speedIndex ? 'active' : ''}">${s}×</button>`).join('')}
          <span class="clock" data-role="clock"></span>
          <button data-action="reset">Nova sessão</button>
        </div>
        <div class="grid">
          <div class="col">
            <div class="box card" data-role="box">
              <div class="lamp" data-role="lamp"></div>
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
                <select name="lever">${scheduleLever}</select>
                <select name="kind">${kindOptions('FR')}</select>
                <input name="value" type="number" value="5" min="0" step="any" aria-label="valor (n ou segundos)" />
                <button type="submit">Aplicar</button>
              </div>
              <p class="hint">Para FR e VR, o valor é o número de respostas. Para os demais, são segundos.</p>
            </form>
            <form class="card" data-form="note">
              <h3>Anotação</h3>
              <div class="row"><input name="text" type="text" placeholder="o que você está testando agora?" /><button type="submit">Anotar</button></div>
            </form>
            <ul class="notes" data-role="notes"></ul>
          </div>
          <div class="col">
            <div class="record card" data-role="record"></div>
            <h3>O que o registro mostra</h3>
            <ul class="feedback card" data-role="feedback"></ul>
            <form class="card" data-form="caderno">
              <h3>Caderno de laboratório</h3>
              <p class="hint">Escreva a hipótese antes de mudar o esquema. Ao concluir, o registro é comparado com o que você declarou.</p>
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
    if (session && !session.ended) {
      if (this.playing && this.lastTs !== null) {
        session.runTo(session.time + (ts - this.lastTs) * SPEEDS[this.speedIndex]);
      }
      if (session.time >= this.durationMs) {
        session.finish();
        this.playing = false;
      }
      this.lastTs = this.playing ? ts : null;
      if (ts - this.lastUi > 250) {
        this.lastUi = ts;
        this.update();
      }
    }
    if (session && !session.ended) this.rafId = requestAnimationFrame(this.loop);
    else this.update();
  };

  private startLoop(): void {
    cancelAnimationFrame(this.rafId);
    this.lastTs = null;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stopLoop(): void {
    cancelAnimationFrame(this.rafId);
    this.session = null;
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
    const ratSlot = q<HTMLElement>('[data-role=rat]');
    if (ratSlot) {
      ratSlot.classList.toggle('press', lastResponse !== undefined && now - lastResponse.t < 250);
      ratSlot.classList.toggle('eat', lastReinforcer !== undefined && now - lastReinforcer.t < 900);
    }
    this.root.querySelectorAll<HTMLElement>('.lever[data-lever]').forEach(el => {
      const lever = Number(el.dataset.lever);
      const pressed = lastResponse?.lever === lever && now - lastResponse.t < 200;
      el.classList.toggle('down', pressed);
    });
    q<HTMLElement>('[data-role=lamp]')?.classList.toggle('on', lastReinforcer !== undefined && now - lastReinforcer.t < 1000);
    q<HTMLElement>('[data-role=pellet]')?.classList.toggle('on', lastReinforcer !== undefined && now - lastReinforcer.t < 900);

    const narr = q<HTMLElement>('[data-role=narr]');
    if (narr) {
      const manual = lastReinforcer?.source === 'manual';
      const mechanical = lastReinforcer
        ? `Reforço ${manual ? 'entregue à mão' : 'automático'} na alavanca ${(lastReinforcer.lever ?? 0) + 1}, aos ${clock(lastReinforcer.t)}.`
        : '';
      const flavour = session.ended
        ? narrate('fim', now)
        : lastReinforcer
          ? narrate(manual ? 'reforco_manual' : 'reforco_auto', lastReinforcer.t)
          : narrate('sem_reforco', now);
      narr.innerHTML = `${esc(mechanical)} <em>${esc(flavour)}</em>`;
    }

    const counters = q<HTMLElement>('[data-role=counters]');
    if (counters) {
      counters.innerHTML = this.levers
        .map((_, i) => {
          const spec = lastSpec(log, i);
          const responses = log.ofType('response', i).length;
          const reinforcers = log.ofType('reinforcer', i).length;
          return `<div><strong>Alavanca ${i + 1}</strong> · ${esc(spec)} · respostas ${responses} · reforços ${reinforcers}</div>`;
        })
        .join('');
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
    if (toggle) toggle.textContent = this.playing ? 'Pausar' : 'Continuar';
  }

  // ---------- eventos ----------

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'start') this.start();
    else if (action === 'toggle') {
      this.playing = !this.playing;
      if (this.session?.ended) this.playing = false;
      this.update();
    } else if (action === 'speed') {
      this.speedIndex = Number(target.dataset.speed);
      this.root.querySelectorAll<HTMLElement>('[data-action=speed]').forEach(b => b.classList.toggle('active', b === target));
    } else if (action === 'deliver') {
      this.act({ kind: 'deliver', lever: Number(target.dataset.lever) });
    } else if (action === 'reset') {
      this.mountSetup();
    } else if (action === 'export') {
      this.exportCsv();
    }
  }

  private onChange(e: Event): void {
    const field = (e.target as HTMLElement).dataset.field;
    if (!field) return;
    const value = (e.target as HTMLInputElement | HTMLSelectElement).value;
    if (field === 'lesson') {
      this.lessonId = value;
      const lesson = LESSONS.find(l => l.id === value);
      if (lesson) this.ratId = lesson.rato;
      this.mountSetup();
    } else if (field === 'rat') this.ratId = value;
    else if (field === 'levers') this.leverCount = Number(value);
    else if (field === 'seed') this.seed = Math.max(1, Math.floor(Number(value) || 1));
  }

  private onSubmit(e: Event): void {
    const form = e.target as HTMLFormElement;
    const kind = form.dataset.form;
    e.preventDefault();
    if (kind === 'schedule') {
      const data = new FormData(form);
      const lever = Number(data.get('lever'));
      const spec = specFrom(String(data.get('kind')) as ScheduleSpec['kind'], Number(data.get('value')));
      this.act({ kind: 'set_schedule', lever, spec });
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
    this.levers = this.lesson ? this.lesson.alavancas : Array.from({ length: this.leverCount }, () => ({ kind: 'FR', n: 5 }) as ScheduleSpec);
    this.durationMs = (this.lesson ? this.lesson.duracaoMin : 20) * MIN;
    this.playing = true;
    this.speedIndex = 0;
    this.session = new Session({
      seed: this.seed,
      durationMs: this.durationMs,
      rat: this.rat,
      levers: this.levers,
      curriculum: this.lesson?.curriculo,
    });
    this.mountPlay();
    this.startLoop();
  }

  private conclude(form: HTMLFormElement): void {
    if (!this.session) return;
    const log = this.session.log;
    form.querySelectorAll<HTMLTextAreaElement>('textarea[data-question]').forEach(area => {
      const index = Number(area.dataset.question);
      const question = this.lesson?.perguntas[index] ?? '';
      if (area.value.trim()) {
        this.session?.act({ kind: 'note', text: `${question} ${area.value.trim()}` });
      }
    });

    const parts = this.levers.map((_, i) => {
      const kindEl = form.querySelector<HTMLSelectElement>(`select[data-declare=kind][data-lever="${i}"]`);
      const valueEl = form.querySelector<HTMLInputElement>(`input[data-declare=value][data-lever="${i}"]`);
      const declared = kindEl && valueEl ? specFrom(kindEl.value as ScheduleSpec['kind'], Number(valueEl.value)) : null;
      const result = classify(inputFromLog(log, i));
      const verdict = declared ? compareIntent(declared, result) : null;
      const label = RESULT_TEXT[result.label] ?? result.label;
      const evidence = result.evidence.map(s => `<li>${esc(s)}</li>`).join('');
      return `
        <div class="lever-result">
          <h4>Alavanca ${i + 1}: ${esc(label)}</h4>
          ${verdict ? `<p class="${verdict.match ? 'ok' : 'miss'}">${esc(verdict.text)}</p>` : ''}
          <ul>${evidence}</ul>
        </div>`;
    });

    const result = this.root.querySelector<HTMLElement>('[data-role=result]');
    if (result) result.innerHTML = `<h3>Comparação</h3>${parts.join('')}`;
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
  const sets = log.ofType('schedule_set', lever);
  const last = sets[sets.length - 1];
  return last?.spec ?? '—';
}

