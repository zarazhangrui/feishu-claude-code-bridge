import type { AgentAdapter, AgentRun } from '../agent/types';
import { log } from '../core/logger';

const PARSE_PROMPT = `你是一个定时任务解析助手。用户的自然语言描述中包含他们想要定时或延迟执行的任务。

用户可能是说两种任务之一：

**1. 周期性任务**（每天/每周/每小时重复）
输出格式：
{"type":"cron","schedule":"标准5位cron表达式","prompt":"执行任务描述","label":"简短标签"}

常见 cron 对照：
- 每天早上 X 点 → "0 X * * *"
- 每隔 N 小时 → "0 */N * * *"
- 每分钟 → "* * * * *"
- 每周一上午 X 点 → "0 X * * 1"
- 工作日每天 X 点 → "0 X * * 1-5"
- 每半小时 → "*/30 * * * *"

**2. 一次性延迟任务**（N分钟后/N小时后/特定时间执行一次）
输出格式：
{"type":"once","delayMinutes":数字,"prompt":"执行任务描述","label":"简短标签"}

常见延迟对照：
- "20分钟后" → delayMinutes: 20
- "1小时后" → delayMinutes: 60
- "明天上午9点" → delayMinutes: (计算到明天9点的分钟数)
- "30秒后" → delayMinutes: 1 (最少1分钟,约整)

时区按 Asia/Shanghai 处理。
如果完全无法解析，输出: {"error": "无法解析时间描述，请更明确地说明执行时间"}

**只输出 JSON，不要其他文字**`;

export interface ParsedCron {
  schedule?: string;
  delayMinutes?: number;
  prompt: string;
  label: string;
}

export type ParseResult =
  | { ok: true; cron: ParsedCron }
  | { ok: false; error: string };

const PARSE_TIMEOUT_MS = 60_000;

export async function parseCronDescription(
  agent: AgentAdapter,
  description: string,
  currentCwd: string,
): Promise<ParseResult> {
  const fullPrompt = `${PARSE_PROMPT}

用户描述: ${description}
当前工作目录: ${currentCwd}`;

  const run: AgentRun = agent.run({
    prompt: fullPrompt,
    cwd: currentCwd,
    permissionMode: 'bypassPermissions',
  });

  let text = '';
  const timer = setTimeout(() => {
    run.stop().catch(() => {});
  }, PARSE_TIMEOUT_MS);

  try {
    for await (const evt of run.events) {
      if (evt.type === 'text') {
        text += evt.delta;
      }
      if (evt.type === 'error') {
        clearTimeout(timer);
        log.warn('cron', 'parse-error', { error: evt.message });
        return { ok: false, error: `Claude 解析失败: ${evt.message}` };
      }
      if (evt.type === 'done') break;
    }
    clearTimeout(timer);

    await run.waitForExit(2000);
    await run.stop();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('cron', 'parse-no-json', { text: text.slice(0, 200) });
      return { ok: false, error: 'Claude 返回格式异常，无法解析为定时任务' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      return { ok: false, error: parsed.error };
    }
    if (!parsed.prompt || !parsed.label) {
      return { ok: false, error: '解析结果缺少必要字段（prompt/label）' };
    }

    if (parsed.type === 'once') {
      const delay = Number(parsed.delayMinutes);
      if (!Number.isFinite(delay) || delay < 1) {
        return { ok: false, error: '延迟时间无效，最少 1 分钟' };
      }
      return {
        ok: true,
        cron: {
          delayMinutes: Math.min(delay, 525600), // cap at 1 year
          prompt: parsed.prompt,
          label: parsed.label,
        },
      };
    }

    // Recurring (cron) — type defaults to "cron" for backward compat
    if (!parsed.schedule) {
      return { ok: false, error: '解析结果缺少时间表达式' };
    }
    return {
      ok: true,
      cron: {
        schedule: parsed.schedule as string,
        prompt: parsed.prompt,
        label: parsed.label,
      },
    };
  } catch (err) {
    clearTimeout(timer);
    run.stop().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('cron', 'parse-crash', { error: msg });
    return { ok: false, error: `解析失败: ${msg}` };
  }
}
