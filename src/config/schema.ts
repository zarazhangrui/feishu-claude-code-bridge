export type TenantBrand = 'feishu' | 'lark';

/**
 * SecretRef points at a secret stored outside this file — keeps secrets out
 * of `config.json` so backups / accidental git commits / log dumps don't
 * leak the bot's App Secret. Mirrors openclaw / lark-cli's `SecretRef`
 * shape so lark-cli's `--source lark-channel` reads it through the same
 * generic `ResolveSecretInput` pipeline as openclaw.
 *
 *   - `env`:  value is in process env at `id` (optionally allowlisted via provider)
 *   - `file`: value is at the path `id` (or `provider.path` if provider config)
 *   - `exec`: spawn `provider.command`, send JSON over stdin, read JSON from stdout
 */
export interface SecretRef {
  source: 'env' | 'file' | 'exec';
  provider?: string;
  id: string;
}

/** A secret field can be either a plain string (potentially a `${VAR}`
 * template) or a SecretRef. JSON deserializer accepts both forms. */
export type SecretInput = string | SecretRef;

export interface AppCredentials {
  id: string;
  secret: SecretInput;
  tenant: TenantBrand;
}

/**
 * `secrets.providers` is openclaw-compatible: each named provider declares
 * how SecretRefs resolve to plaintext (env allowlist, file path, exec
 * command). Only the fields actually consumed by bridge's resolver are
 * typed here; lark-cli reads the same JSON via its richer Go types.
 */
export interface ProviderConfig {
  source: 'env' | 'file' | 'exec';
  /** env: allowlist of env var names that ref.id is allowed to be in. */
  allowlist?: string[];
  /** file: optional base path; ref.id is joined onto it. */
  path?: string;
  /** exec: command to spawn + args. */
  command?: string;
  args?: string[];
  /** exec: explicit env to inject (key=value pairs). */
  env?: Record<string, string>;
  /** exec: env var names to pass through from parent env. */
  passEnv?: string[];
  /** exec: max ms to wait for the child. */
  noOutputTimeoutMs?: number;
  /** exec: max stdout bytes accepted before treating as runaway. */
  maxOutputBytes?: number;
}

export interface SecretsConfig {
  providers?: Record<string, ProviderConfig>;
  defaults?: { env?: string; file?: string; exec?: string };
}

/**
 * How replies are rendered in IM chats:
 *   - `card`: full interactive card (tool panels, ⏹ button, footer status)
 *   - `markdown`: lightweight streaming markdown card (typewriter, no buttons)
 *   - `text`: plain markdown post sent once at run completion (no streaming)
 *
 * Pre-0.1.27 only had `card` and `text`, where `text` meant what's now called
 * `markdown`. See `messageReplyMigrated` for the auto-coercion logic.
 */
export type MessageReplyMode = 'card' | 'markdown' | 'text';

/**
 * Access control settings.
 *
 * Semantics (post-2026-05 redesign, see wiki/T7EswTtVsiF1hMkCYNxc51ASnZc):
 *
 *   - `allowedUsers`: open_id allowlist for DM senders. Empty = nobody can
 *     DM the bot (except creators / admins, which also pass the DM gate).
 *     Group senders are NOT gated by this list — group gating is chat-level.
 *   - `allowedChats`: chat_id allowlist for groups the bot responds in.
 *     Empty = bot doesn't respond in any group (except when the sender is
 *     the creator or an admin, who bypass the chat whitelist). Doesn't
 *     apply to p2p.
 *   - `admins`: open_id list with admin privileges (sensitive commands
 *     `/account` `/config` `/exit` `/reconnect` `/doctor` `/cd` `/ws`).
 *     Empty = only the creator can run admin commands. Non-empty = list +
 *     creator. Admins also bypass the group chat whitelist, so the bot
 *     responds to them in any group regardless of `allowedChats`.
 *
 * There is no `creator` field — the creator identity is the Lark app's
 * current owner, fetched at runtime via `application/v6/applications` and
 * cached on `Controls.botOwnerId`. See `bot/lark-info.ts`. This lets a
 * developer-console ownership transfer take effect without a config edit.
 *
 * Default-secure: all three lists empty + no resolved owner = the bot
 * silently drops every incoming message. Operators tighten via `/config`.
 */
export interface AppAccess {
  /** open_id allowlist for DM senders. Empty = no DM (except creator /
   * admin). Group senders are gated by `allowedChats`, not this list. */
  allowedUsers?: string[];
  /** chat_id allowlist for groups the bot responds in. Empty = no group
   * response (except creator / admins, who bypass it). Doesn't apply to
   * p2p. */
  allowedChats?: string[];
  /** open_id list with admin privileges (sensitive commands). Empty = only
   * the creator can run admin commands. */
  admins?: string[];
}

export interface AppPreferences {
  /** Reply rendering mode for IM (group/p2p) messages. Default 'card'. */
  messageReply?: MessageReplyMode;
  /**
   * Internal marker: pre-0.1.27 the value `'text'` meant "lightweight
   * streaming markdown card" (what's now called `'markdown'`). On upgrade
   * we'd silently switch those users to true plain-text behavior unless we
   * coerce; this flag is set the first time the user submits `/config`
   * after the rename, indicating their `messageReply` value is in the
   * new semantic.
   */
  messageReplyMigrated?: boolean;
  /**
   * Whether to render tool-call blocks (Bash / Read / Edit / ...) in the
   * output. Default true. Turn off if you only care about Claude's final
   * text answer and want to hide the "工具调用过程".
   */
  showToolCalls?: boolean;
  /**
   * Cap on concurrent claude runs across all chats / topics. Excess runs
   * queue FIFO. Default 10. Mostly relevant for topic groups where each
   * topic can spawn its own run; capping protects RAM / token spend.
   */
  maxConcurrentRuns?: number;
  /**
   * Global default idle-timeout for claude runs, in minutes. When set,
   * if claude emits no stream event for this long the bridge kills the
   * run as presumed-hung. Undefined / 0 = no timeout (the default — runs
   * can hang indefinitely). Per-scope `/timeout` overrides this.
   */
  runIdleTimeoutMinutes?: number;
  /**
   * Whether the bot only responds to messages that @-mention it in groups
   * (regular and topic groups). p2p is always unrestricted. Default true:
   * groups are quiet unless the user @bot. Set false to let any group
   * message reach Claude (the 0.1.21-and-earlier behavior).
   *
   * @全员 is never responded to regardless (SDK `respondToMentionAll: false`).
   * Cloud-doc comments still require @-mention unconditionally.
   */
  requireMentionInGroup?: boolean;
  /** Access control — user/chat allowlists + admin gating. See AppAccess. */
  access?: AppAccess;
  /**
   * Grace period (ms) between SIGTERM and SIGKILL when killing the claude
   * subprocess. Bumped from a hardcoded 500ms because claude often has its
   * own subprocesses (e.g. lark-cli mid-OAuth) that need a moment to clean
   * up — too short a window and the SIGKILL cascade kills the descendants
   * before they can finish what the user is waiting on. Default 5000ms.
   * Range 100-30000; out-of-range values fall back to default.
   */
  agentStopGraceMs?: number;
}

/**
 * Top-level config shape on disk.
 *
 * `accounts` is a namespace for credential-flavored fields (currently just
 * the bot app, room for OAuth / alternate apps later). `preferences`
 * holds user-tunable behavior knobs. Other future sections (mcp, etc.)
 * belong at this top level alongside them.
 */
export interface AppConfig {
  accounts: {
    app: AppCredentials;
  };
  secrets?: SecretsConfig;
  preferences?: AppPreferences;
}

export function isComplete(cfg: Partial<AppConfig>): cfg is AppConfig {
  const app = cfg.accounts?.app;
  return Boolean(app?.id && hasSecret(app?.secret) && app?.tenant);
}

function hasSecret(s: SecretInput | undefined): boolean {
  if (!s) return false;
  if (typeof s === 'string') return s.length > 0;
  return Boolean(s.source && s.id);
}

/** True iff this credential's secret is stored externally (env/file/exec). */
export function isSecretRef(s: SecretInput): s is SecretRef {
  return typeof s === 'object' && s !== null;
}

/** Account/keystore key for the bot's App Secret. lark-cli also uses a
 * similar `appsecret:` convention so audit/grep is consistent. */
export function secretKeyForApp(appId: string): string {
  return `app-${appId}`;
}

/**
 * Resolve the message-reply preference with default fallback + legacy coerce.
 *
 * Pre-0.1.27 users with `messageReply: 'text'` actually wanted the streaming
 * markdown card (the new `'markdown'`). Until they re-submit `/config`
 * (which sets `messageReplyMigrated: true`), we map their `text` →
 * `markdown` so the behavior stays the same after upgrade.
 *
 * Default for fresh configs (no `messageReply` set) is `'markdown'`.
 */
export function getMessageReplyMode(cfg: AppConfig): MessageReplyMode {
  const raw = cfg.preferences?.messageReply;
  if (raw === 'text' && cfg.preferences?.messageReplyMigrated !== true) {
    return 'markdown';
  }
  if (raw === 'card' || raw === 'markdown' || raw === 'text') return raw;
  return 'markdown';
}

/** Resolve the show-tool-calls preference with default fallback. */
export function getShowToolCalls(cfg: AppConfig): boolean {
  return cfg.preferences?.showToolCalls !== false;
}

/** Resolve the max-concurrent-runs preference with default + sanity clamp. */
export function getMaxConcurrentRuns(cfg: AppConfig): number {
  const raw = cfg.preferences?.maxConcurrentRuns;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return 10;
  // Reasonable upper bound — at 50+ concurrent claudes the bot box is
  // probably already RAM-starved. Clamp to keep typos from killing the box.
  return Math.min(Math.floor(raw), 50);
}

/**
 * Resolve the require-mention-in-group preference. Default `true` — the
 * `!== false` check makes "undefined" (older configs that don't have the
 * field) inherit the new safer default automatically.
 */
export function getRequireMentionInGroup(cfg: AppConfig): boolean {
  return cfg.preferences?.requireMentionInGroup !== false;
}

/**
 * Resolve the global default idle-timeout in ms. Returns `undefined` when
 * disabled (the default). Clamps to [1, 120] minutes when set so a typo
 * can't lock the bot into a 1-second kill loop or wait forever to a number
 * the user didn't really mean.
 */
/**
 * Grace period before SIGKILL fallback when stopping a claude subprocess.
 * Returns ms. Defaults to 5000 (5 seconds). Clamps to [100, 30000] so a
 * typo can't either make stop() effectively SIGKILL-immediate or hang for
 * minutes.
 */
export function getAgentStopGraceMs(cfg: AppConfig): number {
  const raw = cfg.preferences?.agentStopGraceMs;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 5000;
  return Math.min(30_000, Math.max(100, Math.floor(raw)));
}

/**
 * Minimal shape carrying the inputs every access check needs:
 *   - `cfg`: the on-disk config (whitelists + admin list)
 *   - `botOwnerId`: the runtime-resolved Lark app owner (the "creator")
 *
 * `Controls` already satisfies this structurally, so callers can pass
 * `controls` directly without rebuilding a wrapper object.
 */
export interface AccessContext {
  cfg: AppConfig;
  botOwnerId?: string;
}

/**
 * Whether `senderId` is the bot's creator (= current Lark app owner). The
 * creator unconditionally bypasses every whitelist. When `botOwnerId` is
 * `undefined` (initial fetch hasn't returned yet, or it failed), this
 * returns false — fail-secure.
 */
export function isCreator(ctx: AccessContext, senderId: string): boolean {
  return Boolean(ctx.botOwnerId) && ctx.botOwnerId === senderId;
}

/**
 * Whether the bot should respond to a message from `senderId`, given the
 * chat type. Used at intake.
 *
 *   - Creator always passes.
 *   - For p2p (DM): `senderId` must be in `allowedUsers ∪ admins`. Empty
 *     intersection = silent drop.
 *   - For groups: returns true unconditionally (chat-level gating happens
 *     in `isChatAllowed`). Keeps intake's two-step pattern: run this first
 *     to drop DM strangers, then run `isChatAllowed` for groups.
 */
export function isUserAllowed(
  ctx: AccessContext,
  senderId: string,
  isP2p: boolean = true,
): boolean {
  if (isCreator(ctx, senderId)) return true;
  if (!isP2p) return true;
  const users = ctx.cfg.preferences?.access?.allowedUsers ?? [];
  const admins = ctx.cfg.preferences?.access?.admins ?? [];
  return users.includes(senderId) || admins.includes(senderId);
}

/**
 * Whether the bot should respond in group `chatId`. Only meaningful for
 * non-p2p chats — DM gating is in `isUserAllowed`.
 *
 *   - If `senderId` is the creator or an admin, always allow — they bypass
 *     the chat whitelist so they can drive the bot in any group (e.g. to
 *     run `/invite group` and add the group from inside it).
 *   - Otherwise: `chatId` must be in `allowedChats`. Empty = silent drop.
 */
export function isChatAllowed(
  ctx: AccessContext,
  chatId: string,
  senderId?: string,
): boolean {
  // isAdmin already returns true for the creator, so this one check covers
  // both bypass identities.
  if (senderId && isAdmin(ctx, senderId)) return true;
  const list = ctx.cfg.preferences?.access?.allowedChats ?? [];
  return list.includes(chatId);
}

/**
 * Whether `senderId` may run admin-gated commands (`/account`, `/config`,
 * `/exit`, `/reconnect`, `/doctor`, `/cd`, `/ws`).
 *
 *   - Creator always passes.
 *   - Else: must be in the `admins` list. Empty list = only the creator —
 *     a tightening from the prior "empty = all allowed users" semantics,
 *     aligned with the fail-secure direction of the redesign.
 */
export function isAdmin(ctx: AccessContext, senderId: string): boolean {
  if (isCreator(ctx, senderId)) return true;
  const list = ctx.cfg.preferences?.access?.admins ?? [];
  return list.includes(senderId);
}

export function getRunIdleTimeoutMs(cfg: AppConfig): number | undefined {
  const raw = cfg.preferences?.runIdleTimeoutMinutes;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  const clamped = Math.min(Math.max(Math.floor(raw), 1), 120);
  return clamped * 60_000;
}
