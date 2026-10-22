/** Fonte única da verdade: toda a sessão é reconstruída a partir deste log. Tempos em ms virtuais. */
export type EventType =
  | 'session_start'
  | 'session_end'
  | 'schedule_set'
  | 'stage_change'
  | 'response'
  | 'reinforcer'
  | 'punishment'
  | 'behavior'
  | 'stimulus'
  | 'note';

export interface LogEvent {
  t: number;
  type: EventType;
  lever?: number;
  source?: 'auto' | 'manual';
  spec?: string;
  text?: string;
  /** Anotação gerada pelo sistema, a partir das ações do estudante. */
  auto?: boolean;
}

export class EventLog {
  private readonly events: LogEvent[] = [];

  add(event: LogEvent): void {
    this.events.push(event);
  }

  get all(): readonly LogEvent[] {
    return this.events;
  }

  ofType(type: EventType, lever?: number): LogEvent[] {
    return this.events.filter(e => e.type === type && (lever === undefined || e.lever === lever));
  }

  times(type: EventType, lever?: number): number[] {
    return this.ofType(type, lever).map(e => e.t);
  }

  toCSV(): string {
    const header = 't_ms,tipo,alavanca,fonte,esquema,texto';
    const rows = this.events.map(e =>
      [e.t, e.type, e.lever ?? '', e.source ?? '', e.spec ?? '', e.text ?? ''].map(csvCell).join(','),
    );
    return [header, ...rows].join('\n');
  }
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
