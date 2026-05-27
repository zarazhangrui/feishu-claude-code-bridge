import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../types';
import { translateEvent } from './stream-json';

/** Collect every AgentEvent produced for a single raw Codex event line. */
function emit(raw: unknown): AgentEvent[] {
  return [...translateEvent(raw)];
}

describe('translateEvent (codex stream-json)', () => {
  it('maps thread.started to a system event carrying the thread id as sessionId', () => {
    expect(emit({ type: 'thread.started', thread_id: 'thr-123' })).toEqual([
      { type: 'system', sessionId: 'thr-123' },
    ]);
  });

  it('ignores turn.started', () => {
    expect(emit({ type: 'turn.started' })).toEqual([]);
  });

  it('maps a completed agent_message item to a text event', () => {
    const raw = {
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'done' },
    };
    expect(emit(raw)).toEqual([{ type: 'text', delta: 'done' }]);
  });

  it('maps a completed reasoning item to a thinking event', () => {
    const raw = {
      type: 'item.completed',
      item: { id: 'r_0', type: 'reasoning', text: 'considering options' },
    };
    expect(emit(raw)).toEqual([{ type: 'thinking', delta: 'considering options' }]);
  });

  it('opens a tool_use when a command_execution item starts', () => {
    const raw = {
      type: 'item.started',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: "/bin/zsh -lc 'echo hi'",
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    };
    expect(emit(raw)).toEqual([
      {
        type: 'tool_use',
        id: 'item_0',
        name: 'shell',
        input: { command: "/bin/zsh -lc 'echo hi'" },
      },
    ]);
  });

  it('closes a successful command_execution as a non-error tool_result', () => {
    const raw = {
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'command_execution',
        command: "/bin/zsh -lc 'echo hi'",
        aggregated_output: 'hi\n',
        exit_code: 0,
        status: 'completed',
      },
    };
    expect(emit(raw)).toEqual([
      { type: 'tool_result', id: 'item_0', output: 'hi\n', isError: false },
    ]);
  });

  it('marks a non-zero command_execution as an error tool_result', () => {
    const raw = {
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'command_execution',
        command: '/bin/zsh -lc false',
        aggregated_output: '',
        exit_code: 1,
        status: 'completed',
      },
    };
    expect(emit(raw)).toEqual([
      { type: 'tool_result', id: 'item_2', output: '', isError: true },
    ]);
  });

  it('maps turn.completed to a usage event followed by done', () => {
    const raw = {
      type: 'turn.completed',
      usage: {
        input_tokens: 37868,
        cached_input_tokens: 23808,
        output_tokens: 38,
        reasoning_output_tokens: 0,
      },
    };
    expect(emit(raw)).toEqual([
      { type: 'usage', inputTokens: 37868, outputTokens: 38 },
      { type: 'done' },
    ]);
  });

  it('maps turn.failed to an error event', () => {
    const raw = { type: 'turn.failed', error: { message: 'model overloaded' } };
    expect(emit(raw)).toEqual([{ type: 'error', message: 'model overloaded' }]);
  });

  it('ignores unknown event types for forward compatibility', () => {
    expect(emit({ type: 'some.future.event', foo: 1 })).toEqual([]);
    expect(emit(null)).toEqual([]);
    expect(emit('not an object')).toEqual([]);
  });

  it('translates a full real text-only run in order', () => {
    const lines: unknown[] = [
      { type: 'thread.started', thread_id: 'thr-abc' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'ok' } },
      {
        type: 'turn.completed',
        usage: { input_tokens: 18887, output_tokens: 17 },
      },
    ];
    const events = lines.flatMap(emit);
    expect(events).toEqual([
      { type: 'system', sessionId: 'thr-abc' },
      { type: 'text', delta: 'ok' },
      { type: 'usage', inputTokens: 18887, outputTokens: 17 },
      { type: 'done' },
    ]);
  });

  it('translates a full real command run in order', () => {
    const lines: unknown[] = [
      { type: 'thread.started', thread_id: 'thr-def' },
      { type: 'turn.started' },
      {
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/bin/zsh -lc 'echo hi'",
          exit_code: null,
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/bin/zsh -lc 'echo hi'",
          aggregated_output: 'hi\n',
          exit_code: 0,
          status: 'completed',
        },
      },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: { input_tokens: 37868, output_tokens: 38 } },
    ];
    const events = lines.flatMap(emit);
    expect(events).toEqual([
      { type: 'system', sessionId: 'thr-def' },
      { type: 'tool_use', id: 'item_0', name: 'shell', input: { command: "/bin/zsh -lc 'echo hi'" } },
      { type: 'tool_result', id: 'item_0', output: 'hi\n', isError: false },
      { type: 'text', delta: 'done' },
      { type: 'usage', inputTokens: 37868, outputTokens: 38 },
      { type: 'done' },
    ]);
  });
});
