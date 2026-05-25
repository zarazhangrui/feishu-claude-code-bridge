import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config/paths';
import { log } from '../core/logger';

export interface CronJob {
  id: string;
  /** Cron expression (5-field) for recurring tasks. Empty string for one-time tasks. */
  schedule: string;
  /** For one-time tasks: Unix timestamp in ms to execute at. Undefined for recurring tasks. */
  runAt?: number;
  prompt: string;
  cwd: string;
  chatId: string;
  senderId: string;
  label: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'error';
}

type CronJobMap = Record<string, CronJob>;

let nextId = 1;

export class CronStore {
  private data: CronJobMap = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = paths.cronJobsFile) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const raw = JSON.parse(text) as CronJobMap;
      this.data = {};
      for (const [id, job] of Object.entries(raw)) {
        if (!job) continue;
        const hasSchedule = typeof job.schedule === 'string';
        const runAt = job.runAt;
        const hasRunAt = typeof runAt === 'number';
        if (!hasSchedule && !hasRunAt) continue;
        if (hasRunAt && runAt < Date.now()) continue;
        this.data[id] = job;
        const numId = parseInt(id.replace('cron_', ''), 10);
        if (!isNaN(numId) && numId >= nextId) nextId = numId + 1;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  list(): CronJob[] {
    return Object.values(this.data).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): CronJob | undefined {
    return this.data[id];
  }

  add(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'enabled'> & { schedule?: string; runAt?: number }): CronJob {
    const id = `cron_${String(nextId++).padStart(3, '0')}`;
    const entry: CronJob = {
      ...job,
      id,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data[id] = entry;
    this.schedulePersist();
    return entry;
  }

  update(id: string, partial: Partial<CronJob>): CronJob | undefined {
    const existing = this.data[id];
    if (!existing) return;
    const updated: CronJob = { ...existing, ...partial, id: existing.id, updatedAt: Date.now() };
    this.data[id] = updated;
    this.schedulePersist();
    return updated;
  }

  remove(id: string): boolean {
    if (!(id in this.data)) return false;
    delete this.data[id];
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
        log.fail('cron', err, { step: 'persist' });
      });
  }
}
