import type { CommentEvent, LarkChannel } from '@larksuiteoapi/node-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../agent/types';
import type { Controls } from '../commands';
import type { AppConfig } from '../config/schema';
import type { SessionStore } from '../session/store';
import type { WorkspaceStore } from '../workspace/store';
import { handleCommentMention } from './comments';

// Reactions touch the live channel API; stub them out so the access-gate
// tests don't need to mock the reaction endpoints. addCommentReaction
// returning false also means the finally-block never calls remove.
vi.mock('./reaction', () => ({
  addCommentReaction: vi.fn(async () => false),
  removeCommentReaction: vi.fn(async () => {}),
}));

function cfgWithAllowedUsers(allowedUsers: string[]): AppConfig {
  return {
    accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
    preferences: { access: { allowedUsers } },
  } as AppConfig;
}

function makeControls(cfg: AppConfig): Controls {
  return {
    restart: async () => {},
    exit: async () => {},
    configPath: '/tmp/config.json',
    cfg,
    processId: 'test',
  };
}

function makeEvent(operatorOpenId: string): CommentEvent {
  return {
    fileToken: 'doctoken',
    fileType: 'docx',
    commentId: 'c1',
    replyId: undefined,
    mentionedBot: true,
    operator: { openId: operatorOpenId },
  } as unknown as CommentEvent;
}

/** Channel whose comment-fetch chain succeeds, so a request that passes the
 * access gate reaches `agent.run`. resolveTarget's wiki lookup throws → the
 * code falls back to the passthrough token. */
function makeHappyChannel(): LarkChannel {
  return {
    rawClient: {
      wiki: { v2: { space: { getNode: async () => { throw new Error('not a wiki node'); } } } },
      drive: {
        v1: {
          fileComment: {
            get: async () => ({
              data: {
                reply_list: {
                  replies: [
                    {
                      reply_id: 'r1',
                      content: { elements: [{ type: 'text_run', text_run: { text: 'hello' } }] },
                    },
                  ],
                },
              },
            }),
            create: async () => ({}),
          },
        },
      },
      request: async () => ({}),
    },
  } as unknown as LarkChannel;
}

function makeAgent(): { agent: AgentAdapter; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(() => ({
    events: (async function* () {
      yield { type: 'done' };
    })(),
    stop: async () => {},
    waitForExit: async () => true,
  }));
  const agent = {
    id: 'claude',
    displayName: 'Claude Code',
    isAvailable: async () => true,
    run,
  } as unknown as AgentAdapter;
  return { agent, run };
}

const sessions = {
  resumeFor: () => undefined,
  set: () => {},
} as unknown as SessionStore;
const workspaces = {
  cwdFor: () => undefined,
} as unknown as WorkspaceStore;

describe('handleCommentMention access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops a cloud-doc @mention from a non-allowlisted operator without running the agent', async () => {
    const { agent, run } = makeAgent();
    // A near-empty channel is fine: the request must be rejected before any
    // channel API call. If the gate regresses, agent.run (or a channel call)
    // would be reached and the assertions below would fail.
    const channel = {} as unknown as LarkChannel;
    await handleCommentMention({
      channel,
      evt: makeEvent('ou_attacker'),
      agent,
      sessions,
      workspaces,
      controls: makeControls(cfgWithAllowedUsers(['ou_owner'])),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the agent for an allowlisted operator', async () => {
    const { agent, run } = makeAgent();
    await handleCommentMention({
      channel: makeHappyChannel(),
      evt: makeEvent('ou_owner'),
      agent,
      sessions,
      workspaces,
      controls: makeControls(cfgWithAllowedUsers(['ou_owner'])),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still allows all operators when the allowlist is empty (back-compat default)', async () => {
    const { agent, run } = makeAgent();
    await handleCommentMention({
      channel: makeHappyChannel(),
      evt: makeEvent('ou_anybody'),
      agent,
      sessions,
      workspaces,
      controls: makeControls(cfgWithAllowedUsers([])),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
