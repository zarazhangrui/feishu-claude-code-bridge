import * as cronParser from 'cron-parser';

interface ButtonSpec {
  text: string;
  value: Record<string, unknown>;
  style?: 'primary' | 'danger' | 'default';
}

function button(spec: ButtonSpec): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: spec.text },
    type: spec.style ?? 'default',
    value: spec.value,
  };
}

function divMd(content: string): object {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function actions(buttons: ButtonSpec[]): object {
  return { tag: 'action', actions: buttons.map(button) };
}

const HR: object = { tag: 'hr' };

function shell(title: string, elements: object[]): object {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: title } },
    elements,
  };
}

export function workspacesCard(current: string | undefined, named: Record<string, string>): object {
  const entries = Object.entries(named);
  const elements: object[] = [];

  elements.push(divMd(`当前 cwd：\`${escapeCode(current ?? '(未设置，使用 $HOME)')}\``));

  if (entries.length === 0) {
    elements.push(HR);
    elements.push(divMd('暂无命名工作空间。'));
    elements.push(
      divMd('💡 发送 `/ws save <name>` 把当前 cwd 存为命名工作空间'),
    );
  } else {
    elements.push(HR);
    entries.forEach(([name, path], i) => {
      const marker = path === current ? '  ← 当前' : '';
      elements.push(divMd(`**${escapeMd(name)}** → \`${escapeCode(path)}\`${marker}`));
      elements.push(
        actions([
          { text: '切换到此处', value: { cmd: 'ws.use', name }, style: 'primary' },
          { text: '删除', value: { cmd: 'ws.remove', name }, style: 'danger' },
        ]),
      );
      if (i < entries.length - 1) elements.push(HR);
    });
  }

  return shell('📂 工作空间', elements);
}

export interface StatusInfo {
  cwd: string;
  sessionId?: string;
  sessionStale: boolean;
  agentName: string;
  /** Session scope (= chatId or chatId:threadId in topic groups). */
  scope: string;
  /** Chat mode — used to label scope. */
  chatMode: 'p2p' | 'group' | 'topic';
}

export function statusCard(info: StatusInfo): object {
  const sessionLine = info.sessionId
    ? `\`${info.sessionId.slice(0, 8)}…\`${info.sessionStale ? ' ⚠️ 旧 cwd，下一条会新建' : ''}`
    : '(无)';
  // For topic groups, surface that the scope is per-topic so the user
  // knows /cd / /new only affect this topic.
  const scopeLine =
    info.chatMode === 'topic'
      ? `\`${escapeCode(info.scope)}\` _（话题独立 session）_`
      : `\`${escapeCode(info.scope)}\``;
  const lines = [
    `🧭 **scope**: ${scopeLine}`,
    `📁 **cwd**: \`${escapeCode(info.cwd)}\``,
    `🔗 **session**: ${sessionLine}`,
    `🤖 **agent**: ${escapeMd(info.agentName)}`,
  ];
  return shell('📊 当前状态', [
    divMd(lines.join('\n')),
    HR,
    actions([
      { text: '🆕 新会话', value: { cmd: 'new' }, style: 'primary' },
      { text: '🔁 恢复会话', value: { cmd: 'resume' } },
      { text: '📂 工作空间', value: { cmd: 'ws.list' } },
      { text: '💡 帮助', value: { cmd: 'help' } },
    ]),
  ]);
}

export interface ResumeEntry {
  sessionId: string;
  preview: string;
  relTime: string;
  lineCount: number;
  current?: boolean;
}

export function resumeCard(cwd: string, entries: ResumeEntry[]): object {
  const elements: object[] = [];
  elements.push(divMd(`当前 cwd：\`${escapeCode(cwd)}\``));

  if (entries.length === 0) {
    elements.push(HR);
    elements.push(divMd('此 cwd 下没有历史会话。'));
    return shell('🔁 恢复历史会话', elements);
  }

  elements.push(HR);
  entries.forEach((e, i) => {
    const marker = e.current ? '  ← 当前' : '';
    elements.push(
      divMd(
        `**${i + 1}.** ${escapeMd(e.preview)}${marker}\n\`${e.sessionId.slice(0, 8)}…\` · ${e.relTime} · ${e.lineCount} 条`,
      ),
    );
    elements.push(
      actions([
        {
          text: e.current ? '已是当前会话' : '▸ 恢复此会话',
          value: { cmd: 'resume.use', arg: e.sessionId },
          style: e.current ? 'default' : 'primary',
        },
      ]),
    );
    if (i < entries.length - 1) elements.push(HR);
  });

  return shell('🔁 恢复历史会话', elements);
}

export function helpCard(): object {
  return shell('💡 使用帮助', [
    divMd(
      [
        '**命令列表**',
        '',
        '- `/new` `/reset` — 清空当前 chat 的会话',
        '- `/new chat [name]` — 新建群+新会话，自动拉你进群',
        '- `/resume [N]` — 列出并恢复历史会话（最多 N 条）',
        '- `/cd <path>` — 切换工作目录（会重置 session）',
        '- `/ws list|save <name>|use <name>|remove <name>` — 工作空间',
        '- `/account` — 查看当前应用；`/account change` 换 appId/secret 并重连',
        '- `/config` — 调整偏好（消息回复方式、工具调用显示）',
        '- `/status` — 当前状态',
        '- `/stop` — 结束当前正在跑的任务（也可点卡片底部 ⏹ 终止 按钮）',
        '- `/timeout [N|off|default]` — 当前 session 的探活分钟数,`/config` 改全局默认',
        '- `/cron <描述>` — 定时任务，自然语言创建（如 `20分钟后检查数据库`）',
        '  `/cron list|remove <id>|toggle <id>` — 管理定时任务',
        '- `/ps` — 列出本机所有 bot,标识当前正在回复的那个',
        '- `/exit <id|#>` — 关掉指定 bot(用 `/ps` 看 id/序号)',
        '- `/reconnect` — 强制重连 WebSocket(网络抖动后 bot 没反应时用)',
        '- `/doctor [描述]` — 把日志和描述喂给 Claude 自助诊断',
        '- `/help` — 本帮助',
        '',
        '其他内容直接交给 Claude。',
      ].join('\n'),
    ),
    HR,
    actions([
      { text: '📊 状态', value: { cmd: 'status' }, style: 'primary' },
      { text: '🔁 恢复会话', value: { cmd: 'resume' } },
      { text: '📂 工作空间', value: { cmd: 'ws.list' } },
      { text: '🆕 新会话', value: { cmd: 'new' } },
    ]),
  ]);
}

export interface CronJobEntry {
  id: string;
  label: string;
  schedule: string;
  runAt?: number;
  enabled: boolean;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'error';
  prompt: string;
}

const NEXT_RUN_LIMIT = 5;

function nextRunTime(schedule: string): string {
  try {
    const interval = cronParser.parseExpression(schedule);
    const next = interval.next();
    const d = next.toDate();
    const now = Date.now();
    const diff = d.getTime() - now;
    if (diff < 0) return '已过期';
    if (diff < 60_000) return '即将执行';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟后`;
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时后`;
    return `${Math.round(diff / 86_400_000)} 天后`;
  } catch {
    return '未知';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}`;
}

export function cronListCard(jobs: CronJobEntry[]): object {
  const elements: object[] = [];
  if (jobs.length === 0) {
    elements.push(divMd('暂无定时任务。'));
    elements.push(divMd('💡 发送 `/cron <描述>` 创建，例如：\n`/cron 每天早上9点检查数据库`'));
  } else {
    for (const job of jobs) {
      const status = job.enabled ? '🟢' : '⚪';
      const lastRun = job.lastRunAt
        ? `上次执行: ${formatTime(job.lastRunAt)} ${job.lastRunStatus === 'success' ? '✓' : '✗'}`
        : '尚未执行';

      // One-time task
      if (job.runAt) {
        const diff = job.runAt - Date.now();
        const countdown = diff > 0 ? delayText(diff) : '即将执行';
        const timeStr = formatTime(job.runAt);
        elements.push(
          divMd(
            `${status} **${job.label}**  \n` +
            `⏳ 一次性 · ${timeStr}（${countdown}）\n` +
            `${lastRun}`,
          ),
        );
        elements.push(
          actions([
            {
              text: '🗑 删除',
              value: { cmd: 'cron.remove', arg: job.id },
              style: 'danger',
            },
          ]),
        );
        elements.push(HR);
        continue;
      }

      // Recurring task
      const nextRun = job.enabled ? `下次执行: ${nextRunTime(job.schedule)}` : '已暂停';
      elements.push(
        divMd(
          `${status} **${job.label}**  \n` +
          `\`${job.schedule}\`  ${nextRun}  \n` +
          `${lastRun}`,
        ),
      );
      elements.push(
        actions([
          {
            text: job.enabled ? '⏸ 暂停' : '▶️ 恢复',
            value: { cmd: 'cron.toggle', arg: job.id },
          },
          {
            text: '🗑 删除',
            value: { cmd: 'cron.remove', arg: job.id },
            style: 'danger',
          },
        ]),
      );
      elements.push(HR);
    }
  }
  return shell('⏰ 定时任务', elements);
}

function delayText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min <= 0) return '即将执行';
  if (min < 60) return `${min} 分钟后`;
  const hour = Math.floor(min / 60);
  const remain = min % 60;
  return remain > 0 ? `${hour} 小时 ${remain} 分钟后` : `${hour} 小时后`;
}

function escapeMd(s: string): string {
  return s.replace(/([*_`\\])/g, '\\$1');
}

function escapeCode(s: string): string {
  return s.replace(/`/g, "'");
}
