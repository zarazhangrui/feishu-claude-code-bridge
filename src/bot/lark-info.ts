import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';

/**
 * Helpers for self-querying the Lark app's metadata at runtime: who currently
 * owns the app (= bot creator), and which chats the bot is a member of.
 *
 * Both are used by access control:
 *   - The owner open_id is the only identity that bypasses every whitelist
 *     in the bridge. It comes from Lark's `application/v6` API rather than
 *     a config field so a developer-console ownership transfer is picked up
 *     automatically without an operator edit.
 *   - The chat list backs the group whitelist dropdown in `/config`. Without
 *     it, the operator would have to paste chat_ids by hand.
 *
 * Both calls fail-soft: on error we log and return undefined / empty list,
 * which collapses access control into "fail-secure" mode where only the
 * explicit whitelists count.
 */

export interface KnownChat {
  id: string;
  name: string;
}

/**
 * Fetch the current owner open_id of the bot's app. The Lark developer
 * console allows transferring ownership, so we don't persist this — call
 * on startup and refresh periodically (and on reconnect).
 *
 * Endpoint: GET /open-apis/application/v6/applications/{app_id}
 * Scope:    self-query needs no additional scope when called as bot identity.
 *
 * Returns undefined when the API errors or the response is shaped
 * unexpectedly. Caller treats `undefined` as "no creator", which combined
 * with empty whitelists fails-secure — the bot stops responding to everyone
 * outside the explicit allowlists.
 */
export async function fetchAppOwnerId(
  channel: LarkChannel,
  appId: string,
): Promise<string | undefined> {
  try {
    const resp = await channel.rawClient.request({
      method: 'GET',
      url: `/open-apis/application/v6/applications/${encodeURIComponent(appId)}?lang=zh_cn`,
    });
    const ownerId = (resp as { data?: { app?: { owner?: { owner_id?: string } } } })
      ?.data?.app?.owner?.owner_id;
    if (typeof ownerId === 'string' && ownerId.length > 0) {
      log.info('lark-info', 'owner-fetched', { ownerId: ownerId.slice(-6) });
      return ownerId;
    }
    log.warn('lark-info', 'owner-missing', {
      hint: 'response did not contain data.app.owner.owner_id',
    });
    return undefined;
  } catch (err) {
    log.warn('lark-info', 'owner-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * List groups the bot is currently a member of. Paginates with a hard cap
 * so a bot installed in thousands of chats can't stall startup. Beyond the
 * cap the operator falls back to the `/config` text input for that field
 * (the picker is a convenience, not the only path).
 *
 * Endpoint: GET /open-apis/im/v1/chats
 * Scope:    `im:chat:readonly` (already granted for normal bot operation).
 */
export async function fetchKnownChats(channel: LarkChannel): Promise<KnownChat[]> {
  const chats: KnownChat[] = [];
  const MAX_PAGES = 5; // 5 pages × 100 = 500 chats. Beyond this, text fallback.
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (pageToken) params.set('page_token', pageToken);
      const resp = await channel.rawClient.request({
        method: 'GET',
        url: `/open-apis/im/v1/chats?${params.toString()}`,
      });
      const data = (
        resp as {
          data?: {
            items?: Array<{ chat_id?: string; name?: string }>;
            has_more?: boolean;
            page_token?: string;
          };
        }
      )?.data;
      for (const it of data?.items ?? []) {
        if (it.chat_id) chats.push({ id: it.chat_id, name: it.name ?? '(无名)' });
      }
      pageToken = data?.has_more ? data?.page_token : undefined;
      pages += 1;
    } while (pageToken && pages < MAX_PAGES);
    log.info('lark-info', 'chats-fetched', {
      count: chats.length,
      pages,
      truncated: Boolean(pageToken),
    });
    return chats;
  } catch (err) {
    log.warn('lark-info', 'chats-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
      partialCount: chats.length,
    });
    return chats;
  }
}
