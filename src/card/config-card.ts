import type { KnownChat } from '../bot/lark-info';
import type { MessageReplyMode } from '../config/schema';

export interface ConfigFormOpts {
  messageReply: MessageReplyMode;
  showToolCalls: boolean;
  maxConcurrentRuns: number;
  /** 0 means "disabled". */
  runIdleTimeoutMinutes: number;
  requireMentionInGroup: boolean;
  /** Current DM allowlist open_ids. */
  allowedUsers: string[];
  /** Current group whitelist chat_ids. */
  allowedChats: string[];
  /** Current admin open_ids. */
  admins: string[];
  /**
   * Chats the bot is currently a member of — populates the
   * `multi_select_static` group whitelist dropdown. The dropdown is a
   * convenience; operators can also hand-paste chat_ids in the sibling
   * text input (handy when this cache is truncated or stale).
   */
  knownChats: KnownChat[];
  /**
   * Current Lark app owner's open_id, if resolved. Shown read-only in the
   * access section so the operator can see who has unconditional access.
   */
  botOwnerId?: string;
}

/**
 * Wrap a list of card elements in a collapsed-by-default panel. CardKit
 * 2.0's form collector walks nested elements, so inputs inside the panel
 * are still picked up on submit. See wiki/T7EswTtVsiF1hMkCYNxc51ASnZc (P0).
 */
function collapsedAccessPanel(title: string, elements: object[]): object {
  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: {
      title: { tag: 'markdown', content: title },
      vertical_align: 'center',
      icon: {
        tag: 'standard_icon',
        token: 'down-small-ccm_outlined',
        size: '16px 16px',
      },
      icon_position: 'follow_text',
      icon_expanded_angle: -180,
    },
    border: { color: 'blue', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements,
  };
}

/** Build a `multi_select_person` (CardKit 2.0) input. */
function personPicker(name: string, defaultIds: string[], placeholder: string): object {
  return {
    tag: 'multi_select_person',
    name,
    placeholder: { tag: 'plain_text', content: placeholder },
    default_value: defaultIds.map((id) => ({ id })),
  };
}

/** Build a `multi_select_static` input from a fixed list of chat options. */
function chatPicker(
  name: string,
  options: KnownChat[],
  defaultIds: string[],
  placeholder: string,
): object {
  return {
    tag: 'multi_select_static',
    name,
    placeholder: { tag: 'plain_text', content: placeholder },
    default_value: defaultIds.map((value) => ({ value })),
    options: options.map((c) => ({
      text: {
        tag: 'plain_text',
        content: `${c.name} (…${c.id.slice(-6)})`,
      },
      value: c.id,
    })),
  };
}

/** A plain text input used as the fallback path next to each picker. */
function textFallback(name: string, placeholder: string): object {
  return {
    tag: 'input',
    name,
    default_value: '',
    placeholder: { tag: 'plain_text', content: placeholder },
    input_type: 'text',
  };
}

/** Form card for `/config`. */
export function configFormCard(opts: ConfigFormOpts): object {
  // Build the access-control section's inner elements, then wrap in a
  // collapsible_panel. The section is collapsed by default so day-to-day
  // tweaks (reply mode, concurrency) aren't visually drowned out by the
  // security knobs most deployments never touch after setup.
  const ownerLabel = opts.botOwnerId
    ? `\`${opts.botOwnerId}\`（自动从 Lark 应用 owner 取，可在开发者后台转让）`
    : '_(未解析 — 初次启动后可能还没取到，或 API 失败；状态可在 /doctor 看)_';

  const noChatsHint =
    opts.knownChats.length === 0
      ? '\n  ⚠️ 当前还没缓存到 bot 所在的群（可能 bridge 刚启动还没拉完，或 bot 还没被拉进任何群），先用下面的"备选"框手填 chat_id'
      : '';

  const accessElements: object[] = [
    {
      tag: 'markdown',
      content:
        '_控制谁能跟 bot 交互、谁能跑敏感命令。**留空 = 不响应**（创建者始终豁免）。下方每个白名单都有"选择器 + 备选文本框"两条入口，选其一即可。_',
    },
    {
      tag: 'markdown',
      content: `\n**创建者**（运行时获取，不可配置）\n${ownerLabel}`,
    },
    {
      tag: 'markdown',
      content:
        '\n**用户白名单**（`allowedUsers`）\n' +
        '_允许跟 bot 私聊的用户。**空 = 仅创建者 / 管理员可 DM**_',
    },
    personPicker('allowed_users_picker', opts.allowedUsers, '选择允许 DM 的用户'),
    textFallback(
      'allowed_users_text',
      '备选：直接填 open_id（逗号分隔，与上方选择器合并去重）',
    ),
    {
      tag: 'markdown',
      content:
        '\n**群白名单**（`allowedChats`）\n' +
        '_bot 只在名单内的群响应（含话题群）。**空 = 不响应任何群**（创建者豁免）_' +
        noChatsHint,
    },
    chatPicker(
      'allowed_chats_picker',
      opts.knownChats,
      opts.allowedChats,
      '从 bot 所在的群里选',
    ),
    textFallback(
      'allowed_chats_text',
      '备选：直接填 chat_id（逗号分隔。在群里发 `/doctor` 可看 chat_id）',
    ),
    {
      tag: 'markdown',
      content:
        '\n**管理员**（`admins`）\n' +
        '_除创建者外，能跑敏感命令: `/account` `/config` `/exit` `/reconnect` `/doctor` `/cd` `/ws`。管理员同时获得 DM 权。_\n' +
        '_空 = 仅创建者可跑（与默认 fail-secure 一致）_',
    },
    personPicker('admins_picker', opts.admins, '选择管理员'),
    textFallback(
      'admins_text',
      '备选：直接填 open_id（逗号分隔，与上方选择器合并去重）',
    ),
  ];

  return {
    schema: '2.0',
    config: { summary: { content: '偏好设置' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            '⚙️ **偏好设置**\n\n' +
            '调整 bot 的行为偏好。改完点提交，**立即生效**（无需重启）并写入 `~/.lark-channel/config.json`。',
        },
        { tag: 'hr' },
        {
          tag: 'form',
          name: 'config_form',
          elements: [
            {
              tag: 'markdown',
              content:
                '**消息回复方式**\n' +
                '_纯文本：agent 跑完一次性发出，不流式，体感最轻_\n' +
                '_消息卡片：轻量流式 markdown 卡片，飞书原生打字机动画_',
            },
            {
              tag: 'select_static',
              name: 'message_reply',
              // 'card' (交互卡片) is hidden from the picker for now; existing
              // configs with `messageReply: 'card'` still work — showConfigForm
              // displays them as 'markdown' in the form, but submitting only
              // overwrites if the user actually picks something.
              initial_option: opts.messageReply === 'card' ? 'markdown' : opts.messageReply,
              options: [
                { text: { tag: 'plain_text', content: '纯文本' }, value: 'text' },
                { text: { tag: 'plain_text', content: '消息卡片（默认）' }, value: 'markdown' },
              ],
            },
            {
              tag: 'markdown',
              content:
                '\n**工具调用显示**\n' +
                '_显示：可以看到 bot 跑了什么命令、读了哪些文件等过程_\n' +
                '_隐藏：只看 agent 最终的文字答复，跳过所有工具块_',
            },
            {
              tag: 'select_static',
              name: 'show_tool_calls',
              initial_option: opts.showToolCalls ? 'show' : 'hide',
              options: [
                { text: { tag: 'plain_text', content: '显示（默认）' }, value: 'show' },
                { text: { tag: 'plain_text', content: '隐藏' }, value: 'hide' },
              ],
            },
            {
              tag: 'markdown',
              content:
                '\n**并发上限**\n' +
                '_全局同时运行的 agent 进程数（主要影响话题群多话题并行场景）_\n' +
                '_默认 10，范围 1-50。超出的请求会 FIFO 排队_',
            },
            {
              tag: 'input',
              name: 'max_concurrent_runs',
              default_value: String(opts.maxConcurrentRuns),
              placeholder: { tag: 'plain_text', content: '10' },
              input_type: 'text',
            },
            {
              tag: 'markdown',
              content:
                '\n**run 探活（分钟）**\n' +
                '_agent 长时间没输出时自动 kill，防止假死_\n' +
                '_0 = 关闭（默认），范围 1-120。可被 `/timeout` 在单个 scope 覆盖_',
            },
            {
              tag: 'input',
              name: 'run_idle_timeout_minutes',
              default_value: String(opts.runIdleTimeoutMinutes),
              placeholder: { tag: 'plain_text', content: '0' },
              input_type: 'text',
            },
            {
              tag: 'markdown',
              content:
                '\n**群里需要 @ bot**\n' +
                '_是（默认）：群和话题群里，不 @ bot 的消息不会触发回复_\n' +
                '_否：任何消息都会发给 agent（0.1.21 及更早版本的行为）_\n' +
                '_私聊永远不需要 @；`@全员` 永远不响应_',
            },
            {
              tag: 'select_static',
              name: 'require_mention_in_group',
              initial_option: opts.requireMentionInGroup ? 'yes' : 'no',
              options: [
                { text: { tag: 'plain_text', content: '是（默认）' }, value: 'yes' },
                { text: { tag: 'plain_text', content: '否' }, value: 'no' },
              ],
            },
            { tag: 'hr' },
            collapsedAccessPanel('🔒 **访问控制**（点击展开）', accessElements),
            {
              tag: 'column_set',
              flex_mode: 'flow',
              horizontal_spacing: 'small',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [
                    {
                      tag: 'button',
                      name: 'submit_btn',
                      text: { tag: 'plain_text', content: '提交' },
                      type: 'primary',
                      form_action_type: 'submit',
                      behaviors: [{ type: 'callback', value: { cmd: 'config.submit' } }],
                    },
                  ],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [
                    {
                      tag: 'button',
                      name: 'cancel_btn',
                      text: { tag: 'plain_text', content: '取消' },
                      behaviors: [{ type: 'callback', value: { cmd: 'config.cancel' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function configSavedCard(opts: ConfigFormOpts): object {
  const replyLabel =
    opts.messageReply === 'card'
      ? '交互卡片'
      : opts.messageReply === 'markdown'
        ? '消息卡片'
        : '纯文本';
  const summarize = (ids: string[]): string =>
    ids.length === 0 ? '_(空)_' : `${ids.length} 项`;
  return {
    schema: '2.0',
    config: { summary: { content: '偏好已保存' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            '✅ **偏好已保存**\n\n' +
            `**消息回复方式**：${replyLabel}\n` +
            `**工具调用显示**：\`${opts.showToolCalls ? 'show' : 'hide'}\`\n` +
            `**并发上限**：\`${opts.maxConcurrentRuns}\`\n` +
            `**run 探活**：\`${opts.runIdleTimeoutMinutes > 0 ? `${opts.runIdleTimeoutMinutes} 分钟` : '关闭'}\`\n` +
            `**群里需要 @ bot**：\`${opts.requireMentionInGroup ? '是' : '否'}\`\n\n` +
            '🔒 **访问控制**\n' +
            `**创建者**：${opts.botOwnerId ? `\`${opts.botOwnerId.slice(0, 10)}…\`` : '_(未解析)_'}\n` +
            `**用户白名单**：${summarize(opts.allowedUsers)}\n` +
            `**群白名单**：${summarize(opts.allowedChats)}\n` +
            `**管理员**：${summarize(opts.admins)}\n\n` +
            '下条消息开始生效。',
        },
      ],
    },
  };
}

export function configCancelledCard(): object {
  return {
    schema: '2.0',
    config: { summary: { content: '已取消' } },
    body: {
      elements: [{ tag: 'markdown', content: '已取消，未做任何修改。' }],
    },
  };
}
