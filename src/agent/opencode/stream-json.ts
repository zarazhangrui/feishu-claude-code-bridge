import type { AgentEvent } from '../types';

interface OpenCodeEvent {
  type?: string;
  content?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  output?: string;
  isError?: boolean;
  toolUseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  message?: string;
  sessionId?: string;
  cwd?: string;
  model?: string;
}

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as OpenCodeEvent;
  const type = evt.type ?? '';

  if (type === 'text' || type === 'content') {
    const text = evt.content ?? evt.text ?? '';
    if (text) yield { type: 'text', delta: text };
    return;
  }

  if (type === 'thinking') {
    const text = evt.content ?? evt.text ?? '';
    if (text) yield { type: 'thinking', delta: text };
    return;
  }

  if (type === 'tool_use' || type === 'tool-use') {
    if (evt.id && evt.name) {
      yield { type: 'tool_use', id: evt.id, name: evt.name, input: evt.input };
    }
    return;
  }

  if (type === 'tool_result' || type === 'tool-result') {
    const id = evt.id ?? evt.toolUseId;
    if (id) {
      yield {
        type: 'tool_result',
        id,
        output: evt.output ?? evt.content ?? '',
        isError: evt.isError === true,
      };
    }
    return;
  }

  if (type === 'usage' || type === 'metrics') {
    yield {
      type: 'usage',
      inputTokens: evt.inputTokens,
      outputTokens: evt.outputTokens,
    };
    return;
  }

  if (type === 'done' || type === 'complete' || type === 'finish') {
    yield { type: 'done', sessionId: evt.sessionId };
    return;
  }

  if (type === 'error') {
    yield { type: 'error', message: evt.message ?? evt.content ?? 'Unknown error' };
    return;
  }

  if (type === 'system' || type === 'init') {
    yield {
      type: 'system',
      sessionId: evt.sessionId,
      cwd: evt.cwd,
      model: evt.model,
    };
    return;
  }
}
