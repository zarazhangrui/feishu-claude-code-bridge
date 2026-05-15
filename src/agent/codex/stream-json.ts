import type { AgentEvent } from '../types';

// Codex CLI emits one JSON object per line via `codex exec --json`. The
// event surface is small and stable as of codex-cli 0.128:
//
//   thread.started   { thread_id }
//   turn.started     {}
//   item.started     { item: { id, type, status, ... } }
//   item.completed   { item: { id, type, status, ... } }
//   turn.completed   { usage: { input_tokens, cached_input_tokens,
//                               output_tokens, reasoning_output_tokens } }
//   turn.failed      { error?: { message } }              (inferred; not sampled)
//
// Unlike Claude, codex does NOT emit incremental text deltas — `agent_message`
// arrives whole on `item.completed`. We surface it as a single `text` event
// so the card renderer just appends it once.
//
// Item types observed:
//   agent_message       { text }
//   command_execution   { command, aggregated_output, exit_code, status }
//   file_change         { changes: [{path, kind}], status }
//   reasoning           (not emitted by exec --json on the wire as of 0.128;
//                       only reflected in usage.reasoning_output_tokens)
//
// Unknown item types are silently ignored — better to lose detail than crash
// when codex adds a new type.

interface CodexItemBase {
  id?: string;
  type?: string;
  status?: string;
}

interface CodexAgentMessageItem extends CodexItemBase {
  type: 'agent_message';
  text?: string;
}

interface CodexCommandExecutionItem extends CodexItemBase {
  type: 'command_execution';
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
}

interface CodexFileChangeItem extends CodexItemBase {
  type: 'file_change';
  changes?: Array<{ path?: string; kind?: string }>;
}

type CodexItem =
  | CodexAgentMessageItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexItemBase;

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexRawEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  error?: { message?: string };
}

export interface CodexTranslatorState {
  /** Last thread_id observed on this stream — emitted again on 'done'. */
  threadId?: string;
}

export function createCodexTranslator() {
  const state: CodexTranslatorState = {};
  return {
    *translate(raw: unknown): Generator<AgentEvent> {
      yield* translateEvent(raw, state);
    },
  };
}

function* translateEvent(raw: unknown, state: CodexTranslatorState): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodexRawEvent;

  switch (evt.type) {
    case 'thread.started': {
      if (typeof evt.thread_id === 'string') {
        state.threadId = evt.thread_id;
        yield { type: 'system', sessionId: evt.thread_id };
      }
      return;
    }

    case 'turn.started':
      return;

    case 'item.started': {
      const item = evt.item;
      if (!item || typeof item.id !== 'string') return;
      if (item.type === 'command_execution') {
        const ci = item as CodexCommandExecutionItem;
        yield {
          type: 'tool_use',
          id: item.id,
          name: 'shell',
          input: { command: ci.command ?? '' },
        };
      } else if (item.type === 'file_change') {
        const fc = item as CodexFileChangeItem;
        yield {
          type: 'tool_use',
          id: item.id,
          name: 'edit',
          input: { changes: fc.changes ?? [] },
        };
      }
      // agent_message has no useful payload on item.started; ignore.
      return;
    }

    case 'item.completed': {
      const item = evt.item;
      if (!item) return;
      if (item.type === 'agent_message') {
        const am = item as CodexAgentMessageItem;
        if (typeof am.text === 'string' && am.text) {
          yield { type: 'text', delta: am.text };
        }
      } else if (item.type === 'command_execution' && typeof item.id === 'string') {
        const ci = item as CodexCommandExecutionItem;
        yield {
          type: 'tool_result',
          id: item.id,
          output: ci.aggregated_output ?? '',
          isError: typeof ci.exit_code === 'number' && ci.exit_code !== 0,
        };
      } else if (item.type === 'file_change' && typeof item.id === 'string') {
        const fc = item as CodexFileChangeItem;
        yield {
          type: 'tool_result',
          id: item.id,
          output: summarizeFileChanges(fc.changes),
          isError: false,
        };
      }
      return;
    }

    case 'turn.completed': {
      if (evt.usage) {
        yield {
          type: 'usage',
          inputTokens: evt.usage.input_tokens,
          outputTokens: evt.usage.output_tokens,
        };
      }
      yield { type: 'done', sessionId: state.threadId };
      return;
    }

    case 'turn.failed': {
      yield {
        type: 'error',
        message: evt.error?.message ?? 'codex turn failed',
      };
      return;
    }
  }
}

function summarizeFileChanges(changes: Array<{ path?: string; kind?: string }> | undefined): string {
  if (!changes || changes.length === 0) return '(no changes)';
  return changes.map((c) => `${c.kind ?? '?'} ${c.path ?? '?'}`).join('\n');
}
