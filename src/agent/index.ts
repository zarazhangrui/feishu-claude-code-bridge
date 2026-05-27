import type { AppConfig } from '../config/schema';
import { getAgentKind } from '../config/schema';
import { ClaudeAdapter } from './claude/adapter';
import { CodexAdapter } from './codex/adapter';
import type { AgentAdapter } from './types';

export type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from './types';
export { ClaudeAdapter } from './claude/adapter';
export { CodexAdapter } from './codex/adapter';

/** Pick the agent adapter the config asks for. Defaults to Claude. */
export function createAgent(cfg: Pick<AppConfig, 'preferences'>): AgentAdapter {
  return getAgentKind(cfg) === 'codex' ? new CodexAdapter() : new ClaudeAdapter();
}
