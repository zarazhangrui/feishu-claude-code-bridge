import type { ChildProcessByStdio } from 'node:child_process';
import { spawn, execSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { log } from '../../core/logger';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';

function findBinary(): string {
  const candidates = ['opencode', join(homedir(), '.opencode', 'bin', 'opencode')];
  for (const bin of candidates) {
    try {
      accessSync(bin, constants.X_OK);
      return bin;
    } catch {}
  }
  return 'opencode';
}

const BRIDGE_SYSTEM_PROMPT = `# lark-channel-bridge 运行约定

你正在 lark-channel-bridge 里跑：把飞书/Lark 用户消息桥到本地 CLI 编程助手。

## bridge_context

每条 user message 顶部会带一个 \`<bridge_context>\` 块，里面是当前对话的 chat_id、chat 类型（p2p / group）、发送者。不要照抄、不要在你的回复里渲染。

## interactive_card

用户发/引用交互卡片时，bridge 会把卡的真实 JSON 注入到 \`<interactive_card>\` 块。不要照抄 XML 标签到回复。

## 回复要求

- 回复要简洁直接
- 使用中文回复
- 除非任务明确要求，否则不要使用工具或搜索文件系统`;

const SERVE_START_TIMEOUT_MS = 30_000;

type OpenCodeChild = ChildProcessByStdio<null, Readable, Readable>;

function detectProxyEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  const existingHttp = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || process.env.all_proxy || process.env.ALL_PROXY;
  if (existingHttp) {
    env.https_proxy = existingHttp;
    env.http_proxy = existingHttp;
  }

  if (!existingHttp && process.platform === 'darwin') {
    try {
      const output = execSync('scutil --proxy 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
      const hp = output.match(/HTTPProxy\s*:\s*(\S+)/);
      const port = output.match(/HTTPPort\s*:\s*(\d+)/);
      if (hp && port) {
        const proxyUrl = `http://${hp[1]}:${port[1]}`;
        env.https_proxy = proxyUrl;
        env.http_proxy = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        env.HTTP_PROXY = proxyUrl;
      }
    } catch {
      // scutil not available
    }
  }

  if (env.https_proxy && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
    env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return env;
}

interface OpenCodePart {
  id?: string;
  type?: string;
  text?: string;
  toolUseId?: string;
  name?: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  content?: string;
  reason?: string;
  tokens?: { input?: number; output?: number };
  cost?: number;
  time?: { start?: number; end?: number };
}

interface OpenCodeMessageResponse {
  info?: {
    id?: string;
    sessionID?: string;
    modelID?: string;
    providerID?: string;
    tokens?: { input?: number; output?: number };
    cost?: number;
    finish?: string;
  };
  parts?: OpenCodePart[];
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';

  private readonly binary: string;
  private readonly defaultProvider: string;
  private readonly defaultModel: string;

  private serveProcess: OpenCodeChild | null = null;
  private servePort: number | null = null;
  private serveReady: Promise<void> | null = null;
  private serveStderr: string[] = [];

  constructor(opts: {
    binary?: string;
    provider?: string;
    model?: string;
  } = {}) {
    this.binary = opts.binary ?? findBinary();
    this.defaultProvider = opts.provider ?? 'opencode';
    this.defaultModel = opts.model ?? 'deepseek-v4-flash-free';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  async ensureServer(): Promise<void> {
    if (this.serveProcess && this.servePort) return;
    if (this.serveReady) return this.serveReady;

    this.serveReady = this._startServer();
    try {
      await this.serveReady;
    } finally {
      if (!this.servePort) {
        this.serveReady = null;
      }
    }
  }

  private async _startServer(): Promise<void> {
    const child = spawn(this.binary, ['serve', '--port', '0', '--print-logs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...detectProxyEnv(),
        OPENCODE_SERVER_PASSWORD: '',
      },
    }) as OpenCodeChild;

    let portResolve!: (p: number) => void;
    let portReject!: (err: Error) => void;
    const portPromise = new Promise<number>((resolve, reject) => {
      portResolve = resolve;
      portReject = reject;
    });

    const timer = setTimeout(() => {
      portReject(new Error('opencode serve did not start within 30s'));
    }, SERVE_START_TIMEOUT_MS);

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let portFound = false;
    rl.on('line', (line: string) => {
      const m = line.match(/opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m && !portFound) {
        portFound = true;
        clearTimeout(timer);
        portResolve(Number(m[1]!));
        rl.close();
      }
    });

    child.on('error', (err) => {
      if (!portFound) {
        clearTimeout(timer);
        portReject(err);
      }
    });
    child.on('exit', (code) => {
      if (!portFound) {
        clearTimeout(timer);
        portReject(new Error(`opencode serve exited with code ${code ?? 'null'} before listing port`));
      }
    });

    this.serveProcess = child;

    // Buffer and forward serve stderr for debugging (stored in class member)
    this.serveStderr = [];
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      // Ring buffer: last 200 lines
      for (const line of text.split('\n').filter(Boolean)) {
        this.serveStderr.push(line);
        if (this.serveStderr.length > 200) this.serveStderr.shift();
      }
      // Also log to JSON file (not shown on terminal to avoid noise)
      log.info('agent', 'serve-stderr', { text: text.slice(0, 500), agent: 'opencode' });
    });

    try {
      this.servePort = await portPromise;
      log.info('agent', 'serve-started', {
        pid: child.pid ?? null,
        port: this.servePort,
        agent: 'opencode',
      });
    } catch (err) {
      child.kill();
      this.serveProcess = null;
      this.serveReady = null;
      throw err;
    }
  }

  async killServer(): Promise<void> {
    if (this.serveProcess && this.serveProcess.exitCode === null) {
      this.serveProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.serveProcess?.kill('SIGKILL');
          resolve();
        }, 3000);
        this.serveProcess?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.serveProcess = null;
    this.servePort = null;
    this.serveReady = null;
  }

  /** Dump recent serve stderr for debugging */
  private dumpStderr(label: string): void {
    const lines = this.serveStderr.slice(-50);
    if (lines.length === 0) return;
    log.fail('opencode', new Error(`serve stderr (${label}):\n${lines.join('\n')}`), { agent: 'opencode' });
  }

  run(opts: AgentRunOptions): AgentRun {
    const port = this.servePort;
    if (!port) {
      return {
        events: (async function* () {
          yield { type: 'error', message: 'opencode serve not started' };
        })(),
        async stop() {},
        waitForExit(): Promise<boolean> {
          return Promise.resolve(true);
        },
      };
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const providerID = this.defaultProvider;
    const modelID = opts.model ?? this.defaultModel;
    const _this = this;
    let aborted = false;

    async function* events(): AsyncGenerator<AgentEvent> {
      // 1. Create or reuse session
      let sessionId: string;
      if (opts.sessionId && opts.sessionId.startsWith('ses_')) {
        sessionId = opts.sessionId;
      } else {
        try {
          const createRes = await fetch(`${baseUrl}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'lark-channel-bridge' }),
          });
          if (!createRes.ok) {
            yield { type: 'error', message: `failed to create session: ${createRes.status}` };
            return;
          }
          const session = await createRes.json() as { id?: string };
          if (!session.id) {
            yield { type: 'error', message: 'session created without id' };
            return;
          }
          sessionId = session.id;
          log.info('agent', 'session-created', { sessionId: sessionId.slice(0, 16), agent: 'opencode' });
        } catch (err) {
          yield { type: 'error', message: `failed to create session: ${(err as Error).message}` };
          return;
        }
      }

      yield { type: 'system', sessionId };

      // 2. Send message
      const isNewSession = !opts.sessionId || !opts.sessionId.startsWith('ses_');
      const systemPrompt = isNewSession ? BRIDGE_SYSTEM_PROMPT : undefined;

      try {
        const msgRes = await fetch(`${baseUrl}/session/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: { providerID, modelID },
            system: systemPrompt,
            parts: [{ type: 'text', text: opts.prompt }],
          }),
          signal: AbortSignal.timeout(300_000),
        });

        if (!msgRes.ok) {
          const errText = await msgRes.text().catch(() => '');
          // Dump recent serve stderr on 500 to help debug root cause
          if (msgRes.status === 500) _this.dumpStderr(`500-err`);
          yield { type: 'error', message: `opencode message failed (${msgRes.status}): ${errText.slice(0, 300)}` };
          return;
        }

        const data = await msgRes.json() as OpenCodeMessageResponse;

        if (!data.parts) {
          yield { type: 'done', sessionId };
          return;
        }

        for (const part of data.parts) {
          if (aborted) break;
          const t = part.type ?? '';

          if (t === 'text') {
            if (part.text) yield { type: 'text', delta: part.text };
          } else if (t === 'reasoning') {
            if (part.text) yield { type: 'thinking', delta: part.text };
          } else if (t === 'tool-use' || t === 'tool_use') {
            if (part.toolUseId && part.name) {
              yield { type: 'tool_use', id: part.toolUseId, name: part.name, input: part.input };
            }
          } else if (t === 'tool-result' || t === 'tool_result') {
            if (part.toolUseId) {
              yield {
                type: 'tool_result',
                id: part.toolUseId,
                output: part.output ?? part.content ?? '',
                isError: part.isError === true,
              };
            }
          } else if (t === 'step-finish' || t === 'finish') {
            const info = data.info;
            if (info?.tokens) {
              yield {
                type: 'usage',
                inputTokens: info.tokens.input,
                outputTokens: info.tokens.output,
                costUsd: info.cost,
              };
            }
          }
        }

        yield { type: 'done', sessionId };
      } catch (err) {
        if (aborted) return;
        yield { type: 'error', message: `opencode request failed: ${(err as Error).message}` };
      }
    }

    return {
      events: events(),
      async stop() {
        aborted = true;
      },
      waitForExit(): Promise<boolean> {
        return Promise.resolve(true);
      },
    };
  }
}
