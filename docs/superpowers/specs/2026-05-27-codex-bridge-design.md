# Codex 适配器设计 (Codex Bridge)

- 日期: 2026-05-27
- 分支: `feat/lisi/codex-bridge`
- 状态: 已批准,进入实现

## 背景与目标

本项目 (`lark-channel-bridge`) 目前只能桥接本地 `claude` CLI。代码已为多 agent 预留了清晰的抽象层 (`src/agent/`):bot / card / session / workspace 层只依赖 `AgentAdapter` / `AgentEvent` 接口,不感知底层 agent。

目标:新增一个 **Codex 适配器**,让用户可以把整个飞书桥接流程跑在 OpenAI Codex CLI (`codex exec`) 上,而不改动 bot 层。

### v1 范围

核心会话流 **+ 新 session 首轮注入精简版 bridge 约定**:

- 发消息 → `codex exec` 跑 → 文本 / reasoning / 工具调用实时渲染到卡片 → 多轮 `resume` 续接 → `/stop` 能停。
- 新 session 首轮把精简版 bridge 约定 prepend 进 prompt(`bridge_context` 别照抄、`chat_id` 怎么用、交互卡片回调、`lark-cli` OAuth 前台阻塞流)。
- agent 选择走配置项 `preferences.agent`,默认 `claude`。

### v1 不做 (YAGNI)

图片输入 (`-i`)、`output_schema`、profile / reasoning-effort 配置、完整版 `BRIDGE_SYSTEM_PROMPT`、CLI flag 覆盖 agent 选择。

## 已核实的 Codex 事实 (codex-cli 0.134.0)

- `codex exec [OPTIONS] "<prompt>"` —— 非交互单次运行,prompt 走参数或 stdin。
- `--json` —— 事件以 JSONL 打到 stdout。
- `codex exec resume <SESSION_ID> [OPTIONS] "<prompt>"` —— 续接,`SESSION_ID` 为 UUID;`--last` 取最近。
- `-C/--cd <DIR>` 工作目录;`--skip-git-repo-check` 允许在非 git 目录跑。
- `--dangerously-bypass-approvals-and-sandbox` 绕过审批 + 沙箱;`-s read-only|workspace-write|danger-full-access` 选沙箱。
- `-m/--model`;`-o/--output-last-message <FILE>`;`--ephemeral` 不落盘 session。

### 实测 `--json` 事件 schema

新建会话 + 执行一条 shell 命令时的真实输出:

```
{"type":"thread.started","thread_id":"019e68b8-...-uuid"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'echo hi'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'echo hi'","aggregated_output":"hi\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}
{"type":"turn.completed","usage":{"input_tokens":37868,"cached_input_tokens":23808,"output_tokens":38,"reasoning_output_tokens":0}}
```

要点:
- `thread.started.thread_id` 是会话标识 → 映射成 `AgentEvent.system.sessionId`。
- 文本以 **item 级** `item.completed` 给出(非逐 token delta)→ 卡片按 item 粒度刷新。
- `item.id` 跨 `item.started` / `item.completed` 稳定 → 直接满足 channel 的 idle-watchdog 配对。
- usage 在 `turn.completed`,**无美元成本字段**。
- stderr 可能有噪声(用户 codex 配置里挂的 MCP server 鉴权报错等)→ 只 `log.warn`,不上抛。

## 架构

镜像现有 `src/agent/claude/`,新增 `src/agent/codex/`:

| 文件 | 职责 |
|---|---|
| `src/agent/codex/adapter.ts` | `CodexAdapter implements AgentAdapter`(`id='codex'`, `displayName='Codex'`)。spawn `codex exec`,进程管理(stop/SIGTERM/waitForExit)照搬 Claude 适配器结构 |
| `src/agent/codex/stream-json.ts` | `translateEvent(raw)`:Codex JSONL → 统一 `AgentEvent`,无状态逐行映射 |
| `src/agent/codex/bridge-prompt.ts` | 精简版 bridge 约定常量 `CODEX_BRIDGE_PROMPT`,仅新 session 首轮 prepend |
| `src/agent/codex/stream-json.test.ts` | fixture 单测:真实 JSONL → 断言 `AgentEvent` 序列 |

改动的现有文件:

| 文件 | 改动 |
|---|---|
| `src/agent/index.ts` | 导出 `CodexAdapter` + 新增 `createAgent(cfg)` 工厂 |
| `src/config/schema.ts` | `AppPreferences.agent?: 'claude' \| 'codex'` + `getAgentKind(cfg)`(默认 `'claude'`) |
| `src/cli/commands/start.ts` | `new ClaudeAdapter()` → `createAgent(cfg)`;`isAvailable()` 失败报错按 agent 区分 |
| `src/cli/commands/service.ts` | `new ClaudeAdapter()` → `createAgent(cfg)` |

bot / card / session / workspace 层零改动。

## `CodexAdapter.run()` 命令构造

- **新 session**:`codex exec --json --skip-git-repo-check -C <cwd> <sandboxFlags> [-m <model>] "<注入约定 + prompt>"`
- **resume**:`codex exec resume <sessionId> --json --skip-git-repo-check -C <cwd> <sandboxFlags> [-m <model>] "<prompt>"`(不注入约定)
- `--skip-git-repo-check` 总是带,匹配 Claude "任意目录可跑"。
- `permissionMode` 映射:
  - `bypassPermissions`(bridge 默认)→ `--dangerously-bypass-approvals-and-sandbox`
  - `plan` → `-s read-only`
  - `acceptEdits` / `default` → `-s workspace-write`
- `stdio: ['ignore', 'pipe', 'pipe']`,stdin 关闭避免 codex 等待 stdin。
- `env: { ...process.env, LARK_CHANNEL: '1' }`(与 Claude 对齐)。
- `stop()` / `waitForExit()` 与 Claude 适配器同构(SIGTERM → grace → SIGKILL)。

## 事件翻译表

| Codex 事件 | AgentEvent |
|---|---|
| `thread.started {thread_id}` | `system {sessionId: thread_id, cwd}` |
| `turn.started` | 忽略 |
| `item.started {type:command_execution, id, command}` | `tool_use {id, name:'shell', input:{command}}` |
| `item.completed {type:command_execution, id, aggregated_output, exit_code}` | `tool_result {id, output:aggregated_output, isError: exit_code!==0}` |
| `item.completed {type:agent_message, text}` | `text {delta:text}` |
| `item.completed {type:reasoning, text/summary}` | `thinking {delta}`(字段名实现时按真实输出确认) |
| `item.started/.completed {type:mcp_tool_call}` | `tool_use` / `tool_result` |
| `turn.completed {usage}` | `usage {inputTokens, outputTokens}` 然后 `done` |
| `turn.failed` / error item | `error {message}` |
| 未知 `type` | 忽略(向前兼容) |

说明:
- `done` 不带 sessionId 无碍 —— channel 已从 `thread.started → system` 存了 sessionId。
- `agent_message` / `reasoning` 只有 `item.completed`(无 `item.started`);`command_execution` 有 started + completed。
- 翻译层无状态,逐行独立映射,与 Claude 的 `translateEvent` 同构。

## 错误处理

照搬 Claude `createEventStream` 收尾逻辑:
- 非零退出码 → `error {message: "codex exited with code N: <stderr 截断>"}`。
- spawn 失败(ENOENT,`child.pid` 为空)→ `error`。
- `turn.failed` / error item → `error`。
- stderr 行 → `log.warn('agent', 'stderr', ...)`,不进事件流。

## 测试

- **核心(进 CI)**:`stream-json.test.ts` —— 用本文档记录的真实 JSONL 作 fixture,逐行喂 `translateEvent`,断言产出的 `AgentEvent` 序列(system → tool_use → tool_result → text → usage → done)。纯确定性,无网络。
- 适配器 `isAvailable()` / 命令构造:轻量单测(可对 arg 构造做纯函数化后断言)。
- 真实 `codex exec` e2e 不进 CI(需 auth + 消耗额度)。

## 验收标准

1. `preferences.agent: 'codex'` 时,`lark-channel-bridge run` 启动后能用 Codex 回复飞书消息。
2. 文本 / 工具调用实时渲染到卡片;多轮对话经 `resume` 续接同一 thread。
3. `/stop` 能停止运行中的 Codex 进程。
4. `preferences.agent` 缺省 / `'claude'` 时行为与现状完全一致。
5. `pnpm typecheck` 与 `pnpm test` 通过。
