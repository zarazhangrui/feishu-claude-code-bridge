import { describe, expect, it } from 'vitest';
import type { AppConfig, CodexReasoningEffort } from '../config/schema';
import { CodexAdapter, createAgent } from './index';

function cfg(agent?: 'claude' | 'codex', codexReasoningEffort?: CodexReasoningEffort): AppConfig {
  return {
    accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
    preferences: { ...(agent ? { agent } : {}), ...(codexReasoningEffort ? { codexReasoningEffort } : {}) },
  };
}

describe('createAgent', () => {
  it('returns the Claude adapter by default', () => {
    expect(createAgent(cfg()).id).toBe('claude');
  });

  it('returns the Claude adapter when configured for claude', () => {
    expect(createAgent(cfg('claude')).id).toBe('claude');
  });

  it('returns the Codex adapter when configured for codex', () => {
    expect(createAgent(cfg('codex')).id).toBe('codex');
  });

  it('wires the configured codex reasoning effort into the adapter', () => {
    const agent = createAgent(cfg('codex', 'medium'));
    expect((agent as CodexAdapter).reasoningEffort).toBe('medium');
  });
});
