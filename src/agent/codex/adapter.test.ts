import { describe, expect, it } from 'vitest';
import { buildCodexArgs } from './adapter';
import { CODEX_BRIDGE_PROMPT } from './bridge-prompt';

describe('buildCodexArgs', () => {
  it('starts a new run with exec + streaming json + git-check skip', () => {
    const args = buildCodexArgs({ prompt: 'hello' });
    expect(args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
  });

  it('prepends the bridge prompt on a new session', () => {
    const args = buildCodexArgs({ prompt: 'hello' });
    const finalPrompt = args.at(-1) ?? '';
    expect(finalPrompt.startsWith(CODEX_BRIDGE_PROMPT)).toBe(true);
    expect(finalPrompt).toContain('hello');
  });

  it('resumes by session id and does NOT re-inject the bridge prompt', () => {
    const args = buildCodexArgs({ prompt: 'next turn', sessionId: 'thr-123' });
    expect(args.slice(0, 4)).toEqual(['exec', 'resume', 'thr-123', '--json']);
    expect(args.at(-1)).toBe('next turn');
  });

  it('passes the working directory via -C', () => {
    const args = buildCodexArgs({ prompt: 'x', cwd: '/work/proj' });
    const i = args.indexOf('-C');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('/work/proj');
  });

  it('omits -C when no cwd is given', () => {
    expect(buildCodexArgs({ prompt: 'x' })).not.toContain('-C');
  });

  it('maps the default (bypass) permission mode to the bypass flag', () => {
    expect(buildCodexArgs({ prompt: 'x' })).toContain(
      '--dangerously-bypass-approvals-and-sandbox',
    );
  });

  it('maps plan mode to a read-only sandbox', () => {
    const args = buildCodexArgs({ prompt: 'x', permissionMode: 'plan' });
    const i = args.indexOf('-s');
    expect(args[i + 1]).toBe('read-only');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('maps acceptEdits to a workspace-write sandbox', () => {
    const args = buildCodexArgs({ prompt: 'x', permissionMode: 'acceptEdits' });
    const i = args.indexOf('-s');
    expect(args[i + 1]).toBe('workspace-write');
  });

  it('passes the model via -m when set', () => {
    const args = buildCodexArgs({ prompt: 'x', model: 'gpt-5.1-codex' });
    const i = args.indexOf('-m');
    expect(args[i + 1]).toBe('gpt-5.1-codex');
  });
});
