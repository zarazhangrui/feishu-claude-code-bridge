import { describe, expect, it } from 'vitest';
import type { AppConfig } from './schema';
import { getAgentKind } from './schema';

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
