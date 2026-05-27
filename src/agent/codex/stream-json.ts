import type { AgentEvent } from '../types';

/**
 * Codex `exec --json` emits one JSON object per line. The shapes we consume
 * (codex-cli 0.134.0), captured live:
 *
 *   {"type":"thread.started","thread_id":"<uuid>"}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{"id":"item_0","type":"command_execution",...}}
 *   {"type":"item.completed","item":{"id":"item_0","type":"command_execution",
 *      "aggregated_output":"hi\n","exit_code":0,"status":"completed"}}
 *   {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done"}}
 *   {"type":"turn.completed","usage":{"input_tokens":..,"output_tokens":..}}
 *
 * Unlike Claude's stream-json, text arrives at item granularity (one
 * `agent_message` item = one finished message), not as token deltas — the
 * card simply refreshes per item.
 */
interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  /** reasoning items may carry a `summary` instead of `text` on some models. */
  summary?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  error?: { message?: string };
  message?: string;
}

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodexRawEvent;

  switch (evt.type) {
    case 'thread.started':
      if (evt.thread_id) yield { type: 'system', sessionId: evt.thread_id };
      return;

    case 'item.started':
      yield* translateItem(evt.item, /* started */ true);
      return;

    case 'item.completed':
      yield* translateItem(evt.item, /* started */ false);
      return;

    case 'turn.completed':
      if (evt.usage) {
        yield {
          type: 'usage',
          inputTokens: evt.usage.input_tokens,
          outputTokens: evt.usage.output_tokens,
        };
      }
      yield { type: 'done' };
      return;

    case 'turn.failed':
    case 'error':
      yield { type: 'error', message: evt.error?.message ?? evt.message ?? 'codex run failed' };
      return;

    default:
      // turn.started and any future event types: nothing to surface.
      return;
  }
}

function* translateItem(item: CodexItem | undefined, started: boolean): Generator<AgentEvent> {
  if (!item || !item.type) return;

  switch (item.type) {
    case 'agent_message':
      // Messages only arrive as item.completed.
      if (!started && typeof item.text === 'string' && item.text) {
        yield { type: 'text', delta: item.text };
      }
      return;

    case 'reasoning': {
      if (started) return;
      const delta = item.text ?? item.summary;
      if (typeof delta === 'string' && delta) yield { type: 'thinking', delta };
      return;
    }

    case 'command_execution':
      if (!item.id) return;
      if (started) {
        yield {
          type: 'tool_use',
          id: item.id,
          name: 'shell',
          input: { command: item.command ?? '' },
        };
      } else {
        yield {
          type: 'tool_result',
          id: item.id,
          output: item.aggregated_output ?? '',
          isError: typeof item.exit_code === 'number' && item.exit_code !== 0,
        };
      }
      return;

    default:
      return;
  }
}
