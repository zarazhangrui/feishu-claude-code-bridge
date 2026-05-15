export type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from './types';
export { ClaudeAdapter } from './claude/adapter';
export { CodexAdapter } from './codex/adapter';

import type { AgentKind } from '../config/schema';
import { ClaudeAdapter } from './claude/adapter';
import { CodexAdapter } from './codex/adapter';
import type { AgentAdapter } from './types';

/**
 * Construct the agent adapter selected by config. Centralized so callers
 * don't grow long switch statements on agent kind.
 */
export function createAgent(kind: AgentKind): AgentAdapter {
  if (kind === 'codex') return new CodexAdapter();
  return new ClaudeAdapter();
}
