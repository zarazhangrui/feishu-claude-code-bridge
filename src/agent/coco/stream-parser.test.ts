import { describe, expect, it } from 'vitest';
import { translateEvent } from './stream-parser';

describe('coco stream parser', () => {
  it('maps streaming assistant text and final result', () => {
    const events = [
      ...translateEvent({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        cwd: '/tmp/demo',
        model: 'openrouter-2o',
      }),
      ...translateEvent({
        type: 'stream_event',
        session_id: 'sess-1',
        delta: { role: 'assistant', content: 'Hello' },
      }),
      ...translateEvent({
        type: 'stream_event',
        session_id: 'sess-1',
        delta: { role: 'assistant', content: ' world' },
      }),
      ...translateEvent({
        type: 'result',
        subtype: 'success',
        session_id: 'sess-1',
        is_error: false,
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0,
      }),
    ];

    expect(events).toEqual([
      { type: 'system', sessionId: 'sess-1', cwd: '/tmp/demo', model: 'openrouter-2o' },
      { type: 'text', delta: 'Hello' },
      { type: 'text', delta: ' world' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0 },
      { type: 'done', sessionId: 'sess-1' },
    ]);
  });

  it('maps tool calls and tool results', () => {
    const events = [
      ...translateEvent({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'Bash',
                arguments: '{"command":"pwd","description":"Print working directory"}',
              },
            },
          ],
        },
      }),
      ...translateEvent({
        type: 'user',
        subtype: 'tool_result',
        tool_use_id: 'tool-1',
        tool_name: 'Bash',
        content: {
          content: [{ type: 'text', text: '/tmp/demo\n<id>123</id>' }],
          structured_content: { stdout: '/tmp/demo\n', stderr: '' },
          is_error: false,
        },
      }),
    ];

    expect(events).toEqual([
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'pwd', description: 'Print working directory' },
      },
      {
        type: 'tool_result',
        id: 'tool-1',
        output: '/tmp/demo\n<id>123</id>',
        isError: false,
      },
    ]);
  });
});
