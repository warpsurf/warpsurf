import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { chatHistoryStore } from '@extension/storage/lib/chat';
import type { Attachment } from '@extension/storage/lib/chat/types';
import { escapeUntrustedContent } from '@src/workflows/shared/messages/utils';

type SessionMessage = { actor: string; content: string; timestamp?: number };

/** Default number of conversation turns to retain in chat history */
const DEFAULT_MAX_TURNS = 25;

export interface BuildChatHistoryOptions {
  latestTaskText?: string; // exclude matching final user turn
  maxTurns?: number; // optional cap on prior turns (pairs), defaults to 25
  stripUserRequestTags?: boolean; // default true
}

const ASSISTANT_ACTORS = new Set<string>([
  'system',
  'chat',
  'search',
  'auto',
  'multiagent',
  'agent_navigator',
  'agent_validator',
  'agent_planner',
]);

function stripUserRequestBlocks(text: string): string {
  try {
    return text.replace(/<\s*user_request\s*>[\s\S]*?<\s*\/\s*user_request\s*>/gi, '').trim();
  } catch {
    return text;
  }
}

export function buildChatHistoryBlock(
  sessionMessages: SessionMessage[],
  opts: BuildChatHistoryOptions = {},
): string | null {
  if (!Array.isArray(sessionMessages) || sessionMessages.length === 0) return null;
  const latest = String(opts.latestTaskText || '').trim();
  const prior = [...sessionMessages];

  // Exclude the most recent user turn if it equals the current task
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i];
    if (String(m?.actor || '').toLowerCase() === 'user') {
      const text = String(m?.content || '').trim();
      if (latest && text === latest) prior.splice(i, prior.length - i);
      break;
    }
  }

  const lines: string[] = [];
  const stripTags = opts.stripUserRequestTags !== false;

  // Cap to last N turns (default 25)
  const capped = (() => {
    const effectiveMaxTurns =
      typeof opts.maxTurns === 'number' && opts.maxTurns > 0 ? opts.maxTurns : DEFAULT_MAX_TURNS;

    const out: SessionMessage[] = [];
    let users = 0;
    for (let i = prior.length - 1; i >= 0; i--) {
      out.push(prior[i]);
      if (String(prior[i].actor).toLowerCase() === 'user') users += 1;
      if (users >= effectiveMaxTurns) break;
    }
    return out.reverse();
  })();

  for (const m of capped) {
    const actor = String(m?.actor || '').toLowerCase();
    let text = String(m?.content || '');
    if (stripTags && text) text = stripUserRequestBlocks(text);
    if (!text) continue;
    if (actor === 'user') lines.push(`USER: ${text}`);
    else if (ASSISTANT_ACTORS.has(actor)) lines.push(`ASSISTANT: ${text}`);
  }

  if (lines.length === 0) return null;
  return `<chat_history>\n[Chat History]\n${lines.join('\n')}\n</chat_history>`;
}

export function buildLLMMessagesWithHistory(
  systemPrompt: string,
  sessionMessages: SessionMessage[],
  latestTaskText: string,
  opts: BuildChatHistoryOptions = {},
  attachments?: Attachment[],
) {
  const messages: Array<any> = [];
  messages.push(new SystemMessage(systemPrompt));
  const block = buildChatHistoryBlock(sessionMessages, { ...opts, latestTaskText });
  if (block) messages.push(new SystemMessage(block));

  // Build the user message — multimodal if attachments are present
  if (attachments?.length) {
    const content: any[] = [{ type: 'text', text: `<user_request>\n${latestTaskText}\n</user_request>` }];
    for (const a of attachments) {
      if (a.type === 'image' && a.dataUrl) {
        content.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      } else if (a.dataUrl) {
        // Document: decode base64 text content and include inline
        const safeName = (a.filename || '').replace(/[&"<>]/g, '_');
        try {
          const b64 = a.dataUrl.split(',')[1];
          const text =
            a.mimeType?.startsWith('text/') || a.mimeType === 'application/json'
              ? atob(b64)
              : `[Binary file: ${safeName} (${a.mimeType})]`;
          const safeText = escapeUntrustedContent(text);
          content.push({ type: 'text', text: `<attached_file name="${safeName}">\n${safeText}\n</attached_file>` });
        } catch {
          content.push({
            type: 'text',
            text: `<attached_file name="${safeName}">[Could not decode file]</attached_file>`,
          });
        }
      }
    }
    messages.push(new HumanMessage({ content }));
  } else {
    messages.push(new HumanMessage(`<user_request>\n${latestTaskText}\n</user_request>`));
  }

  return messages;
}

/**
 * Fetch and build chat history block for a given session ID.
 * Returns null if session not found, empty, or on error.
 */
export async function getChatHistoryForSession(
  sessionId: string,
  opts: BuildChatHistoryOptions = {},
): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const session = await chatHistoryStore.getSession(sessionId);
    const msgs = Array.isArray(session?.messages) ? session.messages : [];
    if (msgs.length === 0) return null;
    return buildChatHistoryBlock(msgs as SessionMessage[], opts);
  } catch {
    return null;
  }
}
