import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config/paths';
import { log } from '../core/logger';

export interface SessionEntry {
  sessionId?: string;
  cwd?: string;
  updatedAt: number;
  idleTimeoutMinutes?: number;
}

type SessionMap = Record<string, SessionEntry>;

/**
 * Sessions are keyed by `${agentId}:${chatId}` to prevent cross-agent
 * contamination (e.g. an opencode session resurfacing when running
 * under claude). Scope-level settings (idleTimeout, etc.) are keyed
 * by bare `chatId`.
 */
function sessionKey(agentId: string, chatId: string): string {
  return `${agentId}:${chatId}`;
}

function isSessionKey(key: string): boolean {
  return key.includes(':');
}

export class SessionStore {
  private data: SessionMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.sessionsFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const raw = JSON.parse(text) as Record<string, Partial<SessionEntry>>;
      this.data = {};
      for (const [key, entry] of Object.entries(raw)) {
        if (!entry || typeof entry.updatedAt !== 'number') continue;

        // Old format (bare chatId): migrate to claude-scoped key
        const storeKey = isSessionKey(key) ? key : sessionKey('claude', key);

        const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId : undefined;
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
        const idleTimeoutMinutes =
          typeof entry.idleTimeoutMinutes === 'number' ? entry.idleTimeoutMinutes : undefined;
        const hasSession = sessionId !== undefined && cwd !== undefined;

        if (!hasSession && idleTimeoutMinutes === undefined) continue;

        // Settings on bare keys live alongside agent-scoped session keys
        if (isSessionKey(key)) {
          this.data[storeKey] = {
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(cwd !== undefined ? { cwd } : {}),
            updatedAt: entry.updatedAt,
          };
        } else {
          this.data[storeKey] = {
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(cwd !== undefined ? { cwd } : {}),
            updatedAt: entry.updatedAt,
            ...(idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes } : {}),
          };
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  resumeFor(agentId: string, chatId: string, cwd: string): string | undefined {
    const entry = this.data[sessionKey(agentId, chatId)];
    if (!entry) return undefined;
    if (entry.cwd !== cwd) return undefined;
    return entry.sessionId;
  }

  getRaw(agentId: string, chatId: string): SessionEntry | undefined {
    return this.data[sessionKey(agentId, chatId)];
  }

  set(agentId: string, chatId: string, sessionId: string, cwd: string): void {
    const key = sessionKey(agentId, chatId);
    const prev = this.data[key];
    this.data[key] = {
      sessionId,
      cwd,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  clear(chatId: string): void {
    let changed = false;
    for (const key of Object.keys(this.data)) {
      if (key === chatId || key.endsWith(`:${chatId}`)) {
        delete this.data[key];
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  getIdleTimeoutMinutes(chatId: string): number | undefined {
    return this.data[chatId]?.idleTimeoutMinutes;
  }

  setIdleTimeoutMinutes(chatId: string, minutes: number): void {
    const clamped = Math.min(Math.max(Math.floor(minutes), 0), 120);
    const prev = this.data[chatId];
    this.data[chatId] = {
      ...(prev ?? { updatedAt: Date.now() }),
      idleTimeoutMinutes: clamped,
      updatedAt: Date.now(),
    };
    this.schedulePersist();
  }

  clearIdleTimeoutOverride(chatId: string): boolean {
    const prev = this.data[chatId];
    if (!prev || prev.idleTimeoutMinutes === undefined) return false;
    const { idleTimeoutMinutes: _, ...rest } = prev;
    this.data[chatId] = { ...rest, updatedAt: Date.now() };
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      })
      .catch((err: unknown) => {
        log.fail('session', err, { step: 'persist' });
      });
  }
}
