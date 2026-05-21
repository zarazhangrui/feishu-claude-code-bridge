import type { AgentEvent } from '../types';

interface CocoToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface CocoToolResultContent {
  content?: Array<{ type?: string; text?: string }>;
  structured_content?: unknown;
  is_error?: boolean;
}

interface CocoRawEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  cwd?: string;
  model?: string;
  message?: {
    role?: string;
    content?: string;
    tool_calls?: CocoToolCall[];
  };
  delta?: {
    role?: string;
    content?: string;
  };
  tool_use_id?: string;
  tool_name?: string;
  content?: CocoToolResultContent | string;
  result?: string;
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  total_cost_usd?: number;
}

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CocoRawEvent;

  if (evt.type === 'system' && evt.subtype === 'init') {
    yield {
      type: 'system',
      sessionId: evt.session_id,
      cwd: evt.cwd,
      model: evt.model,
    };
    return;
  }

  if (evt.type === 'stream_event' && evt.delta?.role === 'assistant') {
    if (typeof evt.delta.content === 'string' && evt.delta.content) {
      yield { type: 'text', delta: evt.delta.content };
    }
    return;
  }

  if (evt.type === 'assistant' && evt.message?.tool_calls) {
    for (const call of evt.message.tool_calls) {
      if (!call.id || !call.function?.name) continue;
      yield {
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      };
    }
    return;
  }

  if (evt.type === 'user' && evt.subtype === 'tool_result' && evt.tool_use_id) {
    const payload = typeof evt.content === 'string' ? evt.content : extractToolResult(evt.content);
    const isError = typeof evt.content === 'object' && evt.content?.is_error === true;
    yield {
      type: 'tool_result',
      id: evt.tool_use_id,
      output: payload,
      isError,
    };
    return;
  }

  if (evt.type === 'result') {
    if (evt.usage) {
      yield {
        type: 'usage',
        inputTokens: evt.usage.input_tokens,
        outputTokens: evt.usage.output_tokens,
        costUsd: evt.total_cost_usd,
      };
    }
    if (evt.is_error) {
      yield { type: 'error', message: typeof evt.result === 'string' ? evt.result : 'coco run failed' };
      return;
    }
    yield { type: 'done', sessionId: evt.session_id };
  }
}

function parseArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractToolResult(content: CocoToolResultContent | undefined): string {
  if (!content) return '';
  const text = content.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('');
  if (text) return text;
  if (content.structured_content !== undefined) {
    return JSON.stringify(content.structured_content);
  }
  return '';
}
