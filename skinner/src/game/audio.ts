/** Sons curtos gerados na hora: nada para baixar. O áudio só começa depois de um toque do usuário. */
export class Sound {
  private ctx: AudioContext | null = null;
  enabled = true;

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  private beep(freq: number, duration: number, type: OscillatorType, volume: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  click(): void {
    this.beep(2400, 0.04, 'square', 0.2);
  }

  pellet(): void {
    this.beep(140, 0.12, 'sine', 0.35);
  }

  press(): void {
    this.beep(700, 0.02, 'triangle', 0.08);
  }
}
