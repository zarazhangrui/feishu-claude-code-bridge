import dns from 'node:dns';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import pkg from '../../../package.json';
import { createAgent } from '../../agent';
import { startChannel, type BridgeChannel } from '../../bot/channel';
import { runRegistrationWizard } from '../../bot/wizard';
import type { Controls } from '../../commands';
import { configurePaths, paths } from '../../config/paths';
import type { AgentKind, AppConfig } from '../../config/schema';
import { getAgentKind, isComplete } from '../../config/schema';
import { loadConfig, saveConfig } from '../../config/store';
import { gcOldLogs, log } from '../../core/logger';
import { gcMediaCache } from '../../media/cache';
import {
  cleanupTmpFiles,
  register,
  sameAppOthers,
  unregisterSync,
  updateEntry,
  type ProcessEntry,
} from '../../runtime/registry';
import { SessionStore } from '../../session/store';
import { WorkspaceStore } from '../../workspace/store';

// Prefer IPv4 — Node 20+ defaults to "verbatim" which respects whatever
// the resolver returns first; in IPv6-broken networks (WSL2, certain VPNs,
// some hotel WiFi) this lands on a dead v6 route and stalls. Explicitly
// prefer v4 avoids that whole class of issue.
dns.setDefaultResultOrder('ipv4first');

// Process-level safety net: never let a stray SDK call / axios timeout
// take the whole bot down. Most outbound calls (channel.send / rawClient.*)
// are async; if any callsite misses a try/catch (or fires an update after
// its enclosing scope returned), the rejection bubbles to here. Log and
// keep the bot alive — losing a single reply is better than crashing.
process.on('unhandledRejection', (reason) => {
  log.fail('process', reason, { kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  log.fail('process', err, { kind: 'uncaughtException' });
});

const MEDIA_GC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StartOptions {
  config?: string;
  /** Shortcut to select agent + default data dir. Ignored if --config is also
   *  passed; otherwise `--codex` → ~/.lark-codex/, `--claude` (or omitted) →
   *  ~/.lark-channel/. Persisted to preferences.agent in the saved config so
   *  subsequent runs without the flag pick up the same agent. */
  agent?: AgentKind;
}

/**
 * Resolve the config path + data dir from the start options.
 *
 * Precedence:
 *   1. Explicit -c <path>  → data dir = dirname(path). agent flag still
 *      applies (persists to preferences.agent) but does NOT change the path.
 *   2. --codex             → ~/.lark-codex/config.json
 *   3. --claude or nothing → ~/.lark-channel/config.json  (default)
 */
function resolveDataLocation(opts: StartOptions): {
  configPath: string;
  customized: boolean;
} {
  if (opts.config) {
    return { configPath: resolve(opts.config), customized: true };
  }
  if (opts.agent === 'codex') {
    return {
      configPath: join(homedir(), '.lark-codex', 'config.json'),
      customized: true,
    };
  }
  return { configPath: paths.configFile, customized: false };
}

export async function runStart(opts: StartOptions): Promise<void> {
  // The data dir for this process is the directory containing the config
  // file. All sessions / workspaces / logs / media / processes.json land
  // there, so multiple `start` instances (one per agent / bot) stay fully
  // isolated. --codex picks ~/.lark-codex by default; --claude (or no flag)
  // picks ~/.lark-channel.
  const { configPath, customized } = resolveDataLocation(opts);
  if (customized) {
    configurePaths(dirname(configPath));
  }
  await mkdir(paths.appDir, { recursive: true });

  const existing = await loadConfig(configPath);

  let cfg: AppConfig;
  if (isComplete(existing)) {
    cfg = existing;
  } else {
    cfg = await runRegistrationWizard();
    await saveConfig(cfg, configPath);
    console.log(`配置已保存到 ${configPath}\n`);
    printScopeReminder();
  }

  // Persist agent shortcut into preferences so subsequent runs from this
  // same data dir don't need the flag again. Also bail clearly if the user
  // asks for an agent that doesn't match the on-disk preference — we don't
  // silently flip it, because preferences.agent on disk is the source of
  // truth for `/status` etc., and a mismatch usually means the user pointed
  // the shortcut at the wrong data dir.
  if (opts.agent) {
    const onDisk = cfg.preferences?.agent;
    if (onDisk && onDisk !== opts.agent) {
      console.error(
        `✗ ${configPath} 里 preferences.agent 是 "${onDisk}"，但你用了 --${opts.agent}。`,
      );
      console.error(`  改 config 或换 --${onDisk} 启动。`);
      process.exit(1);
    }
    if (onDisk !== opts.agent) {
      cfg = {
        ...cfg,
        preferences: { ...(cfg.preferences ?? {}), agent: opts.agent },
      };
      await saveConfig(cfg, configPath);
      console.log(`已写入 preferences.agent = "${opts.agent}"\n`);
    }
  }

  const agentKind = getAgentKind(cfg);
  const agent = createAgent(agentKind);
  if (!(await agent.isAvailable())) {
    if (agentKind === 'codex') {
      console.error('✗ 未找到 codex CLI。请先安装 OpenAI Codex CLI 并 `codex login`。');
    } else {
      console.error('✗ 未找到 claude CLI。请先安装 Claude Code：');
      console.error('  https://docs.anthropic.com/en/docs/claude-code/quickstart');
    }
    process.exit(1);
  }

  const sessions = new SessionStore();
  await sessions.load();
  const workspaces = new WorkspaceStore();
  await workspaces.load();

  await gcMediaCache(MEDIA_GC_MAX_AGE_MS);
  await gcOldLogs();

  // Same-app conflict detection. Open-platform routes events to one of the
  // long-connections at random, so two `start` of the same app makes "who
  // answered me" unpredictable. Warn + interactive triage before connecting.
  const conflicts = sameAppOthers(cfg.accounts.app.id);
  if (conflicts.length > 0) {
    const proceed = await resolveConflict(cfg, conflicts);
    if (!proceed) {
      console.log('已取消启动。');
      process.exit(0);
    }
  }

  // Register self in the process registry. Cleanup is wired via stop() and
  // 'exit' below — both paths run unregisterSync so stale entries don't
  // poison the next start.
  const entry = await register({
    appId: cfg.accounts.app.id,
    tenant: cfg.accounts.app.tenant,
    configPath,
    version: pkg.version,
  });
  log.info('registry', 'registered', { id: entry.id, pid: process.pid });

  // `bridge` is mutable so /account can swap it on restart. `controls` carries
  // restart() and a snapshot of the current cfg so command handlers can read
  // and replace credentials without plumbing through the whole runStart scope.
  let bridge: BridgeChannel;
  let restarting = false;

  let stopping = false;
  const stop = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\n收到 ${sig}，正在关闭...`);
    try {
      await bridge.disconnect();
    } catch (err) {
      console.error('[disconnect-failed]', err);
    }
    // unregister is best-effort sync — we're about to exit anyway.
    unregisterSync(entry.id);
    process.exit(0);
  };

  const controls: Controls = {
    configPath,
    cfg,
    processId: entry.id,
    async exit() {
      await stop('exit-command');
    },
    async restart() {
      if (restarting) return;
      restarting = true;
      try {
        console.log('[restart] disconnecting old bridge...');
        try {
          await bridge.disconnect();
        } catch (err) {
          console.warn('[restart] disconnect failed:', err);
        }
        const next = await loadConfig(configPath);
        if (!isComplete(next)) throw new Error('config incomplete after change');
        controls.cfg = next;
        // Keep the registry in sync so /ps reflects the new app after an
        // /account change. Same process id, new app fields. botName is
        // refreshed below once the new channel is up.
        await updateEntry(entry.id, {
          appId: next.accounts.app.id,
          tenant: next.accounts.app.tenant,
          configPath,
          botName: undefined,
        }).catch((err) =>
          log.warn('registry', 'update-failed', { err: String(err) }),
        );
        console.log(
          `[restart] reconnecting with appId=${next.accounts.app.id} tenant=${next.accounts.app.tenant}...`,
        );
        bridge = await startChannel({ cfg: next, agent, sessions, workspaces, controls });
        const restartedBotName = bridge.channel.botIdentity?.name;
        if (restartedBotName) {
          await updateEntry(entry.id, { botName: restartedBotName }).catch((err) =>
            log.warn('registry', 'update-failed', { step: 'botName', err: String(err) }),
          );
        }
        console.log('✓ 已用新凭据重连');
      } finally {
        restarting = false;
      }
    },
  };

  bridge = await startChannel({ cfg, agent, sessions, workspaces, controls });

  // Backfill the bot's display name into the registry once WS handshake is
  // done — future starts conflicting on this app can show it in the prompt
  // ("bot 尼莫 (cli_xxx)") instead of just a short id.
  const botName = bridge.channel.botIdentity?.name;
  if (botName) {
    await updateEntry(entry.id, { botName }).catch((err) =>
      log.warn('registry', 'update-failed', { step: 'botName', err: String(err) }),
    );
  }

  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  // Last-ditch sync unregister in case something exits without going through
  // stop() (e.g. uncaughtException with process.exit(1)).
  process.on('exit', () => {
    unregisterSync(entry.id);
    cleanupTmpFiles();
  });

  // keep the event loop alive until a signal arrives
  await new Promise<void>(() => {});
}

/**
 * Print the same-app conflict, then ask the user how to proceed. Returns
 * true to continue starting (after killing the old ones), false to cancel.
 *
 * Non-TTY (launchd / systemd / piped) skips the prompt and warns — a service
 * manager can't answer questions, and erroring out by default would surprise
 * users running a daemon.
 */
async function resolveConflict(
  cfg: AppConfig,
  conflicts: ProcessEntry[],
): Promise<boolean> {
  console.log(
    `⚠️  检测到这个飞书应用已经有 ${conflicts.length} 个 bot 正在运行:`,
  );
  for (const e of conflicts) {
    const ago = formatAgo(Date.now() - new Date(e.startedAt).getTime());
    // botName 只在 WS 连上后才回填,刚启动 / 连接失败的旧 entry 可能没有。
    const label = e.botName ? `bot ${e.botName} (${e.appId})` : `bot ${e.appId}`;
    console.log(`   - ${label},进程 ${e.id},${ago}启动`);
  }
  console.log('');

  if (!process.stdin.isTTY) {
    console.warn(
      '⚠️  当前不是交互式启动,已自动取消。如需替换,先用 `lark-channel-bridge stop <bot id>` 关掉旧的。\n',
    );
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));
  try {
    const verb = conflicts.length > 1 ? '它们' : '那个';
    const answer = (await ask(`继续启动会先关掉${verb},是否继续? [y/N]: `))
      .trim()
      .toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      return false;
    }
    for (const e of conflicts) {
      try {
        process.kill(e.pid, 'SIGTERM');
        console.log(`✓ 已关掉 bot ${e.id}`);
      } catch (err) {
        console.warn(`✗ 关掉 bot ${e.id} 失败:${(err as Error).message}`);
      }
    }
    // Brief wait so targets unregister themselves before we register on top.
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } finally {
    rl.close();
  }
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)} 秒前`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  return `${Math.floor(ms / 86_400_000)} 天前`;
}

function printScopeReminder(): void {
  console.log('请到开放平台为该应用确认以下能力：\n');
  console.log('  权限 scope:');
  console.log('    - im:message');
  console.log('    - im:message:send_as_bot');
  console.log('    - im:resource');
  console.log('    - im:chat (创建群需要)');
  console.log('    - drive:drive (读写云文档评论需要)\n');
  console.log('  事件订阅（长连接模式）:');
  console.log('    - im.message.receive_v1');
  console.log('    - card.action.trigger');
  console.log('    - drive.notice.comment_add_v1 (云文档 @bot 需要)');
  console.log('    - im.message.reaction.created_v1 / deleted_v1（可选）');
  console.log('    - im.chat.member.bot.added_v1（可选）\n');
}
