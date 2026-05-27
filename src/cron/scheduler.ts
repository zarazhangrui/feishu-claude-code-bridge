import * as cron from 'node-cron';
import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import type { AgentAdapter } from '../agent/types';
import {
  initialState,
  reduce,
  finalizeIfRunning,
  type RunState,
} from '../card/run-state';
import { renderCard } from '../card/run-renderer';
import { log } from '../core/logger';
import type { CronJob, CronStore } from './store';

export interface SchedulerDeps {
  channel: LarkChannel;
  agent: AgentAdapter;
  store: CronStore;
  getStopGraceMs: () => number;
}

export class CronScheduler {
  private readonly cronTasks = new Map<string, cron.ScheduledTask>();
  private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deps: SchedulerDeps;
  private running = false;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const jobs = this.deps.store.list();
    for (const job of jobs) {
      if (job.enabled) this.schedule(job);
    }
    log.info('cron', 'scheduler-started', { total: jobs.length });
  }

  stop(): void {
    this.running = false;
    for (const task of this.cronTasks.values()) {
      task.stop();
    }
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.cronTasks.clear();
    this.timeoutTimers.clear();
    log.info('cron', 'scheduler-stopped');
  }

  schedule(job: CronJob): void {
    this.unschedule(job.id);

    // One-time task (runAt-based)
    if (job.runAt) {
      const delay = job.runAt - Date.now();
      if (delay <= 0) {
        log.info('cron', 'run-at-already-past', { id: job.id });
        this.deps.store.remove(job.id);
        return;
      }
      const timer = setTimeout(async () => {
        await this.execute(job);
        this.unschedule(job.id);
        this.deps.store.remove(job.id);
      }, delay);
      this.timeoutTimers.set(job.id, timer);
      log.info('cron', 'scheduled-once', {
        id: job.id, label: job.label,
        in: Math.round(delay / 1000) + 's',
      });
      return;
    }

    // Recurring task (cron-based)
    if (!cron.validate(job.schedule)) {
      log.warn('cron', 'invalid-schedule', { id: job.id, schedule: job.schedule });
      return;
    }

    const task = cron.schedule(job.schedule, () => {
      this.execute(job);
    });
    this.cronTasks.set(job.id, task);
    log.info('cron', 'scheduled-recurring', {
      id: job.id, schedule: job.schedule, label: job.label,
    });
  }

  unschedule(jobId: string): void {
    const cronTask = this.cronTasks.get(jobId);
    if (cronTask) {
      cronTask.stop();
      this.cronTasks.delete(jobId);
    }
    const timer = this.timeoutTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(jobId);
    }
  }

  private async execute(job: CronJob): Promise<void> {
    const { channel, agent, store } = this.deps;
    const chatId = job.chatId;

    log.info('cron', 'execute-start', { id: job.id, label: job.label });

    try {
      const run = agent.run({
        prompt: `[定时任务: ${job.label}] ${job.prompt}\n\n请完成上述任务，完成后输出清晰的中文总结。`,
        cwd: job.cwd,
        stopGraceMs: this.deps.getStopGraceMs(),
      });

      const initial: RunState = {
        ...initialState,
        blocks: [
          { kind: 'text' as const, content: `⏰ **定时任务: ${job.label}**\n📂 \`${job.cwd}\`\n\n---\n`, streaming: false },
        ],
      };

      let state: RunState = initial;
      await channel.stream(chatId, {
        card: {
          initial: renderCard(state),
          producer: async (ctrl) => {
            for await (const evt of run.events) {
              if (evt.type === 'system') continue;
              if (evt.type === 'usage') {
                log.info('cron', 'usage', {
                  id: job.id,
                  costUsd: evt.costUsd !== undefined ? Number(evt.costUsd.toFixed(4)) : undefined,
                });
                continue;
              }
              state = reduce(state, evt);
              await ctrl.update(renderCard(state));
              if (state.terminal !== 'running') break;
            }
            state = finalizeIfRunning(state);
            await ctrl.update(renderCard(state));
            await run.stop();
          },
        },
      });

      store.update(job.id, { lastRunAt: Date.now(), lastRunStatus: 'success' });
      log.info('cron', 'execute-success', { id: job.id });
    } catch (err) {
      log.fail('cron', err, { id: job.id });
      store.update(job.id, { lastRunStatus: 'error' });

      try {
        await channel.send(chatId, {
          markdown: `❌ **定时任务执行失败: ${job.label}**\n\`\`\`\n${err instanceof Error ? err.message : String(err)}\n\`\`\``,
        });
      } catch {
        // best effort
      }
    }
  }
}
