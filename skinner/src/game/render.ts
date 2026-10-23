import { BAR_X, type Behavior, type Sim, type SimEvent } from './sim';

export type CabeloEstilo = 'topete' | 'curto' | 'cacheado' | 'liso-franja' | 'grisalho';

export interface Roupa {
  cor: string;
  padrao?: 'liso' | 'listras' | 'risca' | 'estampa' | 'jaleco';
  cor2?: string;
}

/** Visual do rato: só estilo de desenho (roupa, cabelo, acessórios), inspirado nas pessoas homenageadas. */
export interface Estilo {
  cabelo?: CabeloEstilo;
  roupa?: Roupa;
  barba?: string;
  bigode?: string;
  oculos?: 'grande' | 'retangular';
  brinco?: string;
  sorriso?: boolean;
}

export interface RatLook {
  pelagem: string;
  cabelo: string | null;
  acessorio: 'gravata' | 'oculos' | 'cracha' | null;
  estilo?: Estilo;
}

interface Floater {
  text: string;
  color: string;
  born: number;
  x: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
}

export const W = 900;
export const H = 372;
const LEFT = 70;
const RIGHT = 830;
const FLOOR = 350;
const LEVER_Y = 280;
const RAT_SCALE = 1.3;

const toPx = (x: number): number => LEFT + x * (RIGHT - LEFT);

/** Desenha a caixa e o rato. Guarda só efeitos visuais; o estado vem da simulação. */
export class Renderer {
  private floaters: Floater[] = [];
  private sparks: Spark[] = [];

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  float(text: string, color: string, now: number, sim: Sim): void {
    this.floaters.push({ text, color, born: now, x: toPx(sim.x) });
    if (this.floaters.length > 4) this.floaters.shift();
  }

  burst(now: number, sim: Sim): void {
    const x = toPx(sim.x);
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14;
      this.sparks.push({ x, y: FLOOR - 50, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 - 60, born: now });
    }
  }

  draw(sim: Sim, look: RatLook, now: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    this.drawBox(sim);
    this.drawRat(sim, look, now);
    this.drawFlash(sim);
    this.drawEffects(now);
  }

  private drawBox(sim: Sim): void {
    const c = this.ctx;
    // parede de acrílico
    const wall = c.createLinearGradient(0, 30, 0, FLOOR);
    wall.addColorStop(0, '#eef6ff');
    wall.addColorStop(1, '#dbe8f5');
    c.fillStyle = wall;
    roundRect(c, 30, 30, W - 60, FLOOR - 30, 18);
    c.fill();
    c.strokeStyle = '#b8c9dc';
    c.lineWidth = 4;
    c.stroke();

    // painel de metal com a barra
    c.fillStyle = '#c9d2dc';
    roundRect(c, toPx(BAR_X) - 70, 120, 140, FLOOR - 120, 10);
    c.fill();

    // piso de grades
    c.fillStyle = '#9aa6b2';
    c.fillRect(30, FLOOR, W - 60, 14);
    c.strokeStyle = '#7d8995';
    c.lineWidth = 3;
    for (let x = 40; x < W - 40; x += 22) {
      c.beginPath();
      c.moveTo(x, FLOOR + 2);
      c.lineTo(x, FLOOR + 12);
      c.stroke();
    }

    // dispensador no teto: a pelota cai onde o rato estiver
    c.fillStyle = '#8b96a3';
    roundRect(c, 44, 34, W - 88, 16, 6);
    c.fill();
    c.fillStyle = '#6b7785';
    for (let x = 60; x < W - 60; x += 30) c.fillRect(x, 46, 10, 5);

    const lastClick = lastEventTime(sim, 'click');
    const since = sim.t - lastClick;
    // LED e "clique!" no canto do dispensador
    c.fillStyle = since < 0.4 ? '#22c55e' : '#cbd5e1';
    c.beginPath();
    c.arc(W - 70, 42, 7, 0, Math.PI * 2);
    c.fill();
    if (since < 0.5) {
      const k = since / 0.5;
      c.fillStyle = `rgba(124,58,237,${1 - k})`;
      c.font = 'bold 22px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText('clique!', W - 70, 82 - k * 16);
    }

    // pelotas: caem do teto e ficam no chão até ele comer
    for (const drop of pelletsOnFloor(sim)) {
      const fall = Math.min(1, (sim.t - drop.t) / 0.25);
      const y = 50 + (FLOOR - 58) * fall * fall;
      c.fillStyle = '#b45309';
      c.beginPath();
      c.arc(toPx(drop.x ?? 0.5), y, 7, 0, Math.PI * 2);
      c.fill();
    }

    // luz de estímulo
    const bx = toPx(BAR_X);
    const lit = sim.lightCycle !== null && sim.light;
    c.fillStyle = lit ? '#fde047' : sim.lightCycle !== null ? '#4b5563' : '#9ca3af';
    c.beginPath();
    c.arc(bx, 160, 18, 0, Math.PI * 2);
    c.fill();
    if (lit) {
      const glow = c.createRadialGradient(bx, 160, 10, bx, 160, 90);
      glow.addColorStop(0, 'rgba(253,224,71,.6)');
      glow.addColorStop(1, 'rgba(253,224,71,0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(bx, 160, 90, 0, Math.PI * 2);
      c.fill();
    }

    // alavanca
    const pressed = sim.t - lastEventTime(sim, 'press') < 0.25;
    c.save();
    c.translate(bx + 30, LEVER_Y);
    c.rotate(pressed ? 0.35 : 0);
    c.fillStyle = sim.barMode === 'auto' ? '#16a34a' : '#374151';
    // barra desativada: recolhida para dentro do painel
    if (sim.barMode !== 'off') {
      roundRect(c, -64, -8, 64, 16, 6);
      c.fill();
    }
    c.restore();
    c.fillStyle = '#1f2937';
    roundRect(c, bx + 24, LEVER_Y - 22, 18, 44, 4);
    c.fill();
  }

  /** Clarão verde no instante do reforço: o jogador vê que o clique valeu. */
  private drawFlash(sim: Sim): void {
    const since = sim.t - lastEventTime(sim, 'click');
    if (since > 0.35) return;
    const c = this.ctx;
    const k = 1 - since / 0.35;
    c.fillStyle = `rgba(34,197,94,${0.18 * k})`;
    c.fillRect(30, 30, W - 60, FLOOR - 30);
    const x = toPx(sim.x);
    const glow = c.createRadialGradient(x, FLOOR - 50, 10, x, FLOOR - 50, 160);
    glow.addColorStop(0, `rgba(34,197,94,${0.45 * k})`);
    glow.addColorStop(1, 'rgba(34,197,94,0)');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, FLOOR - 50, 160, 0, Math.PI * 2);
    c.fill();
  }

  private drawRat(sim: Sim, look: RatLook, now: number): void {
    const c = this.ctx;
    c.save();
    c.translate(toPx(sim.x), FLOOR - 4);
    // rato um pouco maior que o real, para ser visível no celular
    c.scale(RAT_SCALE, RAT_SCALE);
    paintRat(c, look, sim.behavior, sim.dir, now / 1000);
    c.restore();
  }

  private drawEffects(now: number): void {
    const c = this.ctx;
    this.sparks = this.sparks.filter(s => now - s.born < 700);
    for (const s of this.sparks) {
      const k = (now - s.born) / 1000;
      c.fillStyle = `rgba(251,191,36,${1 - k / 0.7})`;
      c.beginPath();
      c.arc(s.x + s.vx * k, s.y + s.vy * k + 200 * k * k, 4, 0, Math.PI * 2);
      c.fill();
    }
    this.floaters = this.floaters.filter(f => now - f.born < 1800);
    c.textAlign = 'center';
    this.floaters.forEach((f, i) => {
      const k = (now - f.born) / 1800;
      c.globalAlpha = 1 - k;
      c.fillStyle = f.color;
      c.font = 'bold 24px system-ui, sans-serif';
      const x = Math.min(W - 120, Math.max(120, f.x));
      c.fillText(f.text, x, FLOOR - 130 - k * 60 - i * 6);
      c.globalAlpha = 1;
    });
  }
}

/** As últimas `sim.pellets` pelotas soltas são as que ainda estão no chão. */
function pelletsOnFloor(sim: Sim): SimEvent[] {
  if (sim.pellets === 0) return [];
  const drops: SimEvent[] = [];
  for (let i = sim.events.length - 1; i >= 0 && drops.length < sim.pellets; i--) {
    if (sim.events[i].kind === 'drop') drops.push(sim.events[i]);
  }
  return drops;
}

function lastEventTime(sim: Sim, kind: 'press' | 'click'): number {
  for (let i = sim.events.length - 1; i >= 0; i--) if (sim.events[i].kind === kind) return sim.events[i].t;
  return -Infinity;
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Clareia ou escurece uma cor hex. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `rgb(${r},${g},${b})`;
}

/** Registro cumulativo: a pena sobe a cada pressão e volta ao pé quando chega ao topo, como no aparelho real. */
export function drawRecord(canvas: HTMLCanvasElement, sim: Sim, from: number, windowSeconds = 300): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = canvas.width;
  const h = canvas.height;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = '#d6d0c2';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, w - 1, h - 1);
  const span = Math.max(windowSeconds, sim.t - from);
  const x = (t: number): number => ((t - from) / span) * (w - 10) + 5;
  const top = 40; // pressões até a pena voltar
  const y = (n: number): number => h - 6 - ((n % top) / top) * (h - 12);

  c.strokeStyle = '#7c3aed';
  c.lineWidth = 2;
  c.beginPath();
  let n = 0;
  c.moveTo(x(from), y(0));
  for (const e of sim.events) {
    if (e.t < from) continue;
    if (e.kind === 'press') {
      c.lineTo(x(e.t), y(n));
      n += 1;
      if (n % top === 0) {
        c.lineTo(x(e.t), 6);
        c.moveTo(x(e.t), y(n));
      } else c.lineTo(x(e.t), y(n));
    } else if (e.kind === 'click') {
      c.stroke();
      c.save();
      c.strokeStyle = '#d97706';
      c.beginPath();
      c.moveTo(x(e.t), y(n));
      c.lineTo(x(e.t) + 5, y(n) + 6);
      c.stroke();
      c.restore();
      c.beginPath();
      c.moveTo(x(e.t), y(n));
    }
  }
  c.lineTo(x(sim.t), y(n));
  c.stroke();
}

/** Desenha o rato com as patas no ponto (0, 0). Usado na caixa e na prévia do menu. */
export function paintRat(c: CanvasRenderingContext2D, look: RatLook, b: Behavior, dir: number, t: number): void {
  const walking = b === 'explorar' || b === 'comedouro' || b === 'aproximar';
  const rearing = b === 'levantar' || b === 'apoiar' || b === 'pressionar';
  const facing = b === 'cheirarBarra' || b === 'apoiar' || b === 'pressionar' ? 1 : dir;
  const estilo = look.estilo ?? {};

  c.save();
  c.scale(facing, 1);
  if (walking) c.translate(0, Math.abs(Math.sin(t * 12)) * -3);

  // rabo
  c.strokeStyle = '#e8a1a1';
  c.lineWidth = 5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-48, -22);
  c.bezierCurveTo(-80, -10 + Math.sin(t * 4) * 6, -100, -40, -120, -30 + Math.sin(t * 3) * 8);
  c.stroke();

  const bodyAngle = rearing ? -1.0 : b === 'comer' || b === 'limpar' ? 0.15 : 0;
  c.save();
  // em pé, o corpo gira em torno das patas de trás, que ficam no piso
  c.translate(-20, rearing ? -40 : -24);
  c.rotate(bodyAngle);

  // pernas
  c.fillStyle = shade(look.pelagem, -25);
  const step = walking ? Math.sin(t * 12) * 6 : 0;
  for (const [lx, ph] of [[-22, 1], [26, -1]] as const) ellipse(c, lx + step * ph, 18, 9, 6);

  // corpo
  c.fillStyle = look.pelagem;
  ellipse(c, 6, 0, 52, 30);
  c.fillStyle = shade(look.pelagem, 18);
  ellipse(c, 10, 8, 34, 16);
  if (estilo.roupa) paintClothes(c, estilo.roupa);

  // acessórios no corpo
  if (look.acessorio === 'gravata') {
    c.fillStyle = '#b91c1c';
    c.beginPath();
    c.moveTo(36, -12);
    c.lineTo(44, -12);
    c.lineTo(42, -6);
    c.lineTo(38, -6);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(38, -6);
    c.lineTo(42, -6);
    c.lineTo(46, 16);
    c.lineTo(40, 22);
    c.lineTo(34, 16);
    c.closePath();
    c.fill();
  }
  if (look.acessorio === 'cracha') {
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#64748b';
    c.lineWidth = 2;
    roundRect(c, 22, -4, 16, 20, 3);
    c.fill();
    c.stroke();
    c.fillStyle = '#2563eb';
    c.fillRect(24, -1, 12, 4);
  }

  // patas da frente
  c.fillStyle = shade(look.pelagem, -25);
  if (b === 'apoiar' || b === 'pressionar') {
    const push = b === 'pressionar' ? Math.abs(Math.sin(t * 10)) * 6 : 0;
    ellipse(c, 64, -6 + push, 10, 6);
  } else if (b === 'limpar') {
    ellipse(c, 58, -14 + Math.sin(t * 14) * 5, 8, 6);
  } else {
    ellipse(c, 44, 22, 8, 5);
  }

  // cabeça
  const nod = b === 'farejar' || b === 'cheirarBarra' ? Math.sin(t * 18) * 3 : 0;
  const headDown = b === 'comer' ? 14 : 0;
  c.save();
  c.translate(58, -10 + nod + headDown);

  // cabelo comprido fica atrás da cabeça
  if (look.cabelo && estilo.cabelo === 'liso-franja') {
    c.fillStyle = look.cabelo;
    c.beginPath();
    c.moveTo(-22, -10);
    c.quadraticCurveTo(-30, 18, -18, 30);
    c.lineTo(-2, 26);
    c.quadraticCurveTo(-8, 8, 0, -16);
    c.closePath();
    c.fill();
  }

  c.fillStyle = look.pelagem;
  ellipse(c, 0, 0, 26, 20);
  ellipse(c, 22, 6, 14, 11);
  // orelha
  c.fillStyle = '#f4b6b6';
  ellipse(c, -6, -18, 10, 11);
  if (estilo.brinco) {
    c.fillStyle = estilo.brinco;
    ellipse(c, -9, -5, 3.5, 4.5);
  }

  // barba
  if (estilo.barba) {
    c.fillStyle = estilo.barba;
    c.beginPath();
    c.moveTo(-4, 6);
    c.quadraticCurveTo(10, 24, 30, 14);
    c.quadraticCurveTo(26, 8, 14, 9);
    c.quadraticCurveTo(4, 10, -4, 6);
    c.closePath();
    c.fill();
  }

  if (estilo.bigode) {
    c.fillStyle = estilo.bigode;
    ellipse(c, 27, 9, 7, 2.6);
  }

  if (look.cabelo) paintHair(c, look.cabelo, estilo.cabelo ?? 'topete');

  // olho
  c.fillStyle = '#111827';
  if (estilo.sorriso) {
    // olho sorridente: arco para cima
    c.strokeStyle = '#111827';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(10, -2, 4, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
  } else {
    ellipse(c, 10, -4, 3.5, 3.5);
  }
  if (estilo.oculos === 'retangular') {
    // armação escura retangular com haste vermelha
    c.strokeStyle = '#dc2626';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(1, -5);
    c.lineTo(-7, -7);
    c.stroke();
    c.strokeStyle = '#111827';
    c.lineWidth = 2.6;
    c.strokeRect(1, -10, 18, 11);
  } else if (look.acessorio === 'oculos' || estilo.oculos) {
    const big = estilo.oculos === 'grande';
    c.strokeStyle = big ? '#7c5a3a' : '#111827';
    c.lineWidth = big ? 3 : 2;
    c.beginPath();
    c.arc(10, -4, big ? 10 : 7, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(big ? 0 : 3, -4);
    c.lineTo(-6, -6);
    c.stroke();
  }

  // focinho, sorriso e bigodes
  c.fillStyle = '#e57b8b';
  ellipse(c, 35, 6, 4, 3.5);
  if (estilo.sorriso) {
    c.strokeStyle = '#7f1d1d';
    c.lineWidth = 1.8;
    c.beginPath();
    c.arc(26, 9, 6, 0.2, Math.PI * 0.8);
    c.stroke();
  }
  c.strokeStyle = 'rgba(55,65,81,.6)';
  c.lineWidth = 1.2;
  for (const dy of [-3, 2, 7]) {
    c.beginPath();
    c.moveTo(30, 6);
    c.lineTo(50, 6 + dy * 1.5 + (b === 'farejar' ? Math.sin(t * 20) * 2 : 0));
    c.stroke();
  }
  c.restore();

  c.restore();
  c.restore();
}

/** Roupa vestida sobre a parte da frente do corpo. */
function paintClothes(c: CanvasRenderingContext2D, roupa: Roupa): void {
  c.save();
  c.beginPath();
  c.ellipse(6, 0, 52, 30, 0, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = roupa.cor;
  // cobre o tronco quase todo; a parte de trás do corpo fica com o pelo
  c.fillRect(-28, -32, 86, 64);
  if (roupa.padrao === 'listras') {
    c.fillStyle = roupa.cor2 ?? shade(roupa.cor, -40);
    for (let x = -26; x < 60; x += 9) c.fillRect(x, -32, 4, 64);
  } else if (roupa.padrao === 'risca') {
    // camisa social de risca fina
    c.fillStyle = roupa.cor2 ?? shade(roupa.cor, -40);
    for (let x = -26; x < 60; x += 5) c.fillRect(x, -32, 1.2, 64);
  } else if (roupa.padrao === 'estampa') {
    const cores = [roupa.cor2 ?? '#f97316', '#2563eb', '#facc15'];
    let i = 0;
    for (let x = -22; x < 60; x += 11) {
      for (let y = -24; y < 30; y += 11) {
        c.fillStyle = cores[i++ % cores.length];
        c.beginPath();
        c.arc(x + ((y / 11) % 2 ? 5 : 0), y, 2.6, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else if (roupa.padrao === 'jaleco') {
    // jaleco branco aberto sobre roupa escura
    c.fillStyle = roupa.cor2 ?? '#111827';
    c.beginPath();
    c.moveTo(34, -32);
    c.lineTo(46, -32);
    c.lineTo(40, 6);
    c.closePath();
    c.fill();
    c.strokeStyle = '#cbd5e1';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(34, -32);
    c.lineTo(40, 6);
    c.lineTo(46, -32);
    c.stroke();
  }
  // gola
  c.strokeStyle = shade(roupa.padrao === 'jaleco' ? '#ffffff' : roupa.cor, -35);
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-28, -32);
  c.lineTo(-28, 32);
  c.stroke();
  c.restore();
}

/** Cabelo sobre a cabeça. */
function paintHair(c: CanvasRenderingContext2D, cor: string, estilo: CabeloEstilo): void {
  c.fillStyle = cor;
  switch (estilo) {
    case 'cacheado':
      for (const [x, y, r] of [[-14, -14, 7], [-6, -22, 8], [4, -24, 8], [13, -20, 7], [-18, -4, 6], [20, -14, 6]] as const) {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case 'liso-franja':
      c.beginPath();
      c.moveTo(-22, -6);
      c.quadraticCurveTo(-16, -30, 6, -24);
      c.quadraticCurveTo(20, -20, 22, -8);
      c.lineTo(16, -6);
      c.lineTo(12, -11);
      c.lineTo(6, -7);
      c.lineTo(0, -12);
      c.lineTo(-6, -8);
      c.closePath();
      c.fill();
      break;
    case 'curto':
    case 'grisalho':
      c.beginPath();
      c.moveTo(-20, -8);
      c.quadraticCurveTo(-14, -28, 6, -24);
      c.quadraticCurveTo(18, -21, 20, -10);
      c.quadraticCurveTo(4, -16, -20, -8);
      c.closePath();
      c.fill();
      break;
    default:
      c.beginPath();
      c.moveTo(-14, -14);
      c.quadraticCurveTo(-4, -34, 14, -22);
      c.quadraticCurveTo(4, -18, -2, -12);
      c.closePath();
      c.fill();
  }
}

/** Prévia do rato no menu: ele alterna alguns comportamentos para mostrar o jeito dele. */
const PREVIEW_CYCLE: Behavior[] = ['farejar', 'levantar', 'limpar', 'explorar', 'cheirarBarra'];

export function drawRatPreview(canvas: HTMLCanvasElement, look: RatLook, now: number): void {
  const c = canvas.getContext('2d');
  if (!c) return;
  const t = now / 1000;
  const b = PREVIEW_CYCLE[Math.floor(t / 1.6) % PREVIEW_CYCLE.length];
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#e8dcc6';
  c.fillRect(0, canvas.height - 14, canvas.width, 14);
  c.save();
  // escala que ainda cabe o rato inteiro em pé, com a cauda à direita
  c.translate(canvas.width / 2 - 10, canvas.height - 16);
  c.scale(1.05, 1.05);
  paintRat(c, look, b, -1, t);
  c.restore();
}
