import { describe, expect, it } from 'vitest';
import type { AppConfig } from './schema';
import { getAgentKind, getCodexReasoningEffort } from './schema';

function cfg(agent?: unknown): AppConfig {
  return {
    accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
    preferences: agent === undefined ? {} : ({ agent } as never),
  };
}

describe('getAgentKind', () => {
  it('defaults to claude when unset', () => {
    expect(getAgentKind(cfg())).toBe('claude');
  });

  it('returns claude when explicitly claude', () => {
    expect(getAgentKind(cfg('claude'))).toBe('claude');
  });

  it('returns codex when set to codex', () => {
    expect(getAgentKind(cfg('codex'))).toBe('codex');
  });

  it('falls back to claude for unrecognized values', () => {
    expect(getAgentKind(cfg('gpt-9000'))).toBe('claude');
  });
});

function withEffort(effort?: unknown): AppConfig {
  return {
    accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
    preferences: { codexReasoningEffort: effort } as never,
  };
}

describe('getCodexReasoningEffort', () => {
  it('returns undefined when unset (let codex use its own default)', () => {
    expect(getCodexReasoningEffort(withEffort())).toBeUndefined();
  });

  it('returns the configured effort level', () => {
    expect(getCodexReasoningEffort(withEffort('medium'))).toBe('medium');
    expect(getCodexReasoningEffort(withEffort('high'))).toBe('high');
  });

  it('returns undefined for unrecognized values', () => {
    expect(getCodexReasoningEffort(withEffort('turbo'))).toBeUndefined();
  });
});
