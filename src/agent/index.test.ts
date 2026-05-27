import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/schema';
import { createAgent } from './index';

function cfg(agent?: 'claude' | 'codex'): AppConfig {
  return {
    accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
    preferences: agent ? { agent } : {},
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
});
