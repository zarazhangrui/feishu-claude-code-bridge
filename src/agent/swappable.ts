import type { AgentAdapter, AgentRun, AgentRunOptions } from './types';

export class SwappableAgent implements AgentAdapter {
  private _current: AgentAdapter;

  constructor(initial: AgentAdapter) {
    this._current = initial;
  }

  get id(): string {
    return this._current.id;
  }

  get displayName(): string {
    return this._current.displayName;
  }

  isAvailable(): Promise<boolean> {
    return this._current.isAvailable();
  }

  run(opts: AgentRunOptions): AgentRun {
    return this._current.run(opts);
  }

  swap(adapter: AgentAdapter): void {
    this._current = adapter;
  }

  get current(): AgentAdapter {
    return this._current;
  }
}
