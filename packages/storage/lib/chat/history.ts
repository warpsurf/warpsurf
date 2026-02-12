import { createStorage } from '../base/base';
import { StorageEnum } from '../base/enums';
import type {
  ChatSession,
  ChatMessage,
  ChatHistoryStorage,
  Message,
  ChatSessionMetadata,
  ChatAgentStepHistory,
  RequestSummary,
  MessageMetadataValue,
  SessionStats,
} from './types';
import { Actors } from './types';
// Access chrome safely in non-extension contexts
// biome-ignore lint/suspicious/noExplicitAny: runtime guard for MV3
const chromeRef: any = (globalThis as any).chrome;

// Key for storing chat session metadata
const CHAT_SESSIONS_META_KEY = 'chat_sessions_meta';

// Create storage for session metadata
const chatSessionsMetaStorage = createStorage<ChatSessionMetadata[]>(CHAT_SESSIONS_META_KEY, [], {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

// Helper function to get storage key for a specific session's messages
const getSessionMessagesKey = (sessionId: string) => `chat_messages_${sessionId}`;

// Helper function to create storage for a specific session's messages
const getSessionMessagesStorage = (sessionId: string) => {
  return createStorage<ChatMessage[]>(getSessionMessagesKey(sessionId), [], {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  });
};

// Helper function to get storage key for a specific session's agent state history
const getSessionAgentStepHistoryKey = (sessionId: string) => `chat_agent_step_${sessionId}`;

// Helper function to get storage for a specific session's agent state history
const getSessionAgentStepHistoryStorage = (sessionId: string) => {
  return createStorage<ChatAgentStepHistory>(
    getSessionAgentStepHistoryKey(sessionId),
    {
      task: '',
      history: '',
      timestamp: 0,
    },
    {
      storageEnum: StorageEnum.Local,
      liveUpdate: true,
    },
  );
};

// Helper function to get current timestamp in milliseconds
const getCurrentTimestamp = (): number => Date.now();

/**
 * Creates a chat history storage instance with optimized operations
 */
export function createChatHistoryStorage(): ChatHistoryStorage {
  return {
    getAllSessions: async (): Promise<ChatSession[]> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();

      // For listing purposes, we can return sessions without loading messages
      // This makes the list view very fast
      return sessionsMeta.map(meta => ({
        ...meta,
        messages: [], // Empty array as we don't load messages for listing
      }));
    },

    clearAllSessions: async (): Promise<void> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();
      for (const sessionMeta of sessionsMeta) {
        const messagesStorage = getSessionMessagesStorage(sessionMeta.id);
        await messagesStorage.set([]);
      }
      await chatSessionsMetaStorage.set([]);
    },

    // Clear messages and related session-scoped data, keeping the session metadata entry
    clearSession: async (sessionId: string): Promise<void> => {
      // Clear messages
      const messagesStorage = getSessionMessagesStorage(sessionId);
      await messagesStorage.set([]);

      // Clear agent step history
      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      await agentStepHistoryStorage.set({ task: '', history: '', timestamp: 0 });

      // Clear per-message request summaries
      try {
        const key = `chat_request_summaries_${sessionId}`;
        const storage = createStorage<Record<string, RequestSummary>>(
          key,
          {},
          { storageEnum: StorageEnum.Local, liveUpdate: true },
        );
        await storage.set({});
      } catch {}

      // Clear per-message metadata
      try {
        const key = `chat_message_metadata_${sessionId}`;
        const storage = createStorage<Record<string, MessageMetadataValue>>(
          key,
          {},
          { storageEnum: StorageEnum.Local, liveUpdate: true },
        );
        await storage.set({});
      } catch {}

      // Reset aggregated session stats
      try {
        const key = `chat_session_stats_${sessionId}`;
        const storage = createStorage<SessionStats>(
          key,
          {
            totalRequests: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalLatency: 0,
            totalCost: 0,
            avgLatencyPerRequest: 0,
          },
          { storageEnum: StorageEnum.Local, liveUpdate: true },
        );
        await storage.set({
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalLatency: 0,
          totalCost: 0,
          avgLatencyPerRequest: 0,
        });
      } catch {}

      // Update session metadata counters
      await chatSessionsMetaStorage.set(prev =>
        prev.map(s => (s.id === sessionId ? { ...s, updatedAt: getCurrentTimestamp(), messageCount: 0 } : s)),
      );
    },

    // Get session metadata without messages (for UI listing)
    getSessionsMetadata: async (): Promise<ChatSessionMetadata[]> => {
      return await chatSessionsMetaStorage.get();
    },

    getSession: async (sessionId: string): Promise<ChatSession | null> => {
      const sessionsMeta = await chatSessionsMetaStorage.get();
      const sessionMeta = sessionsMeta.find(session => session.id === sessionId);

      if (!sessionMeta) return null;

      // Load messages only when a specific session is requested
      const messagesStorage = getSessionMessagesStorage(sessionId);
      let rawMessages = await messagesStorage.get();

      // Normalize actor values from stored messages
      const normalizeActor = (value: any): Actors => {
        const v = String(value || '').toLowerCase();
        switch (v) {
          case 'user':
            return Actors.USER;
          case 'system':
            return Actors.SYSTEM;
          case 'estimator':
            return Actors.ESTIMATOR;
          case 'agent_navigator':
            return Actors.AGENT_NAVIGATOR;
          case 'agent_planner':
            return Actors.AGENT_PLANNER;
          case 'agent_validator':
            return Actors.AGENT_VALIDATOR;
          case 'chat':
            return Actors.CHAT;
          case 'search':
            return Actors.SEARCH;
          case 'auto':
            return Actors.AUTO;
          case 'multiagent':
            return Actors.MULTIAGENT;
          case 'tool':
            return Actors.TOOL;
          default:
            return Actors.CHAT;
        }
      };

      const toNumber = (n: any): number => {
        const x = typeof n === 'number' ? n : Number(n);
        return Number.isFinite(x) ? x : Date.now();
      };

      let normalized: ChatMessage[] = (rawMessages as any[]).map((m: any) => {
        const content =
          typeof m?.content === 'string' ? m.content : typeof m?.text === 'string' ? m.text : String(m?.message ?? '');
        const timestamp =
          m?.timestamp !== undefined
            ? toNumber(m.timestamp)
            : m?.createdAt !== undefined
              ? toNumber(m.createdAt)
              : Date.now();
        const eventIdRaw = m?.eventId ?? m?.event_id;
        const eventId = eventIdRaw ? String(eventIdRaw) : undefined;
        const actorSource = m?.actor ?? m?.role ?? m?.sender ?? m?.author;
        const actor = normalizeActor(actorSource);
        const id =
          typeof m?.id === 'string' && m.id.length > 0
            ? m.id
            : typeof crypto?.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${timestamp}-${actor}`;
        return { id, content, timestamp, actor, eventId } as ChatMessage;
      });

      // Fallback recovery: if no messages were found, try to discover legacy keys that include this sessionId
      if ((!normalized || normalized.length === 0) && chromeRef?.storage?.local?.get) {
        try {
          const all = await chromeRef.storage.local.get(null);
          const candidateKeys = Object.keys(all || {}).filter(k => k.includes(sessionId));
          for (const key of candidateKeys) {
            const val = (all as Record<string, unknown>)[key];
            if (Array.isArray(val) && val.length > 0) {
              const looksLikeMessages = (val as any[]).every(
                (m: any) =>
                  typeof m === 'object' &&
                  m !== null &&
                  (typeof (m as any).content === 'string' ||
                    typeof (m as any).text === 'string' ||
                    typeof (m as any).message === 'string'),
              );
              if (looksLikeMessages) {
                normalized = (val as any[]).map((m: any) => {
                  const content =
                    typeof m?.content === 'string'
                      ? m.content
                      : typeof m?.text === 'string'
                        ? m.text
                        : String(m?.message ?? '');
                  const timestamp =
                    m?.timestamp !== undefined
                      ? toNumber(m.timestamp)
                      : m?.createdAt !== undefined
                        ? toNumber(m.createdAt)
                        : Date.now();
                  const eventIdRaw = m?.eventId ?? m?.event_id;
                  const eventId = eventIdRaw ? String(eventIdRaw) : undefined;
                  const actorSource = m?.actor ?? m?.role ?? m?.sender ?? m?.author;
                  const actor = normalizeActor(actorSource);
                  const id =
                    typeof m?.id === 'string' && m.id.length > 0
                      ? m.id
                      : typeof crypto?.randomUUID === 'function'
                        ? crypto.randomUUID()
                        : `${timestamp}-${actor}`;
                  return { id, content, timestamp, actor, eventId } as ChatMessage;
                });
                // Persist recovered messages into the canonical key and update metadata
                await messagesStorage.set(normalized);
                await chatSessionsMetaStorage.set(prev =>
                  prev.map(meta =>
                    meta.id === sessionId
                      ? { ...meta, messageCount: normalized.length, updatedAt: getCurrentTimestamp() }
                      : meta,
                  ),
                );
                break;
              }
            }
          }
        } catch {}
      }

      // Deduplicate messages (eventId-first, then actor+timestamp+content).
      // This prevents legacy double-writes and replay-related duplicates from showing up in the UI.
      try {
        const seen = new Set<string>();
        const deduped: ChatMessage[] = [];
        for (const m of normalized || []) {
          const eventId = (m as any)?.eventId ? String((m as any).eventId).trim() : '';
          const actor = String((m as any)?.actor || '');
          const ts = Number((m as any)?.timestamp || 0);
          const content = String((m as any)?.content ?? '').trim();
          const key = eventId ? `event:${eventId}` : `${actor}|${ts}|${content}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(m);
        }
        if (deduped.length !== normalized.length) normalized = deduped;
      } catch {}

      // If normalization changed anything (e.g., missing actors), persist the normalized form back to storage
      try {
        const changed =
          normalized.length !== (rawMessages as any[]).length ||
          normalized.some((nm, idx) => {
            const om: any = (rawMessages as any[])[idx] || {};
            return !om?.actor || om?.actor !== nm.actor || typeof om?.timestamp !== 'number' || !om?.id;
          });
        if (changed) {
          await messagesStorage.set(normalized);
          // Keep metadata roughly in sync
          await chatSessionsMetaStorage.set(prev =>
            prev.map(meta =>
              meta.id === sessionId
                ? { ...meta, messageCount: normalized.length, updatedAt: getCurrentTimestamp() }
                : meta,
            ),
          );
        }
      } catch {}

      return {
        ...sessionMeta,
        messages: normalized,
      };
    },

    createSession: async (title: string): Promise<ChatSession> => {
      const newSessionId = crypto.randomUUID();
      const currentTime = getCurrentTimestamp();
      const newSessionMeta: ChatSessionMetadata = {
        id: newSessionId,
        title,
        createdAt: currentTime,
        updatedAt: currentTime,
        messageCount: 0,
      };

      // Create empty messages array for the new session
      const messagesStorage = getSessionMessagesStorage(newSessionId);
      await messagesStorage.set([]);

      // Add session metadata to the index
      await chatSessionsMetaStorage.set(prevSessions => [...prevSessions, newSessionMeta]);

      return {
        ...newSessionMeta,
        messages: [],
      };
    },

    /**
     * Create a session with a specific ID (for synchronous ID generation)
     * This allows the caller to generate and use the ID immediately before the async session creation completes
     */
    createSessionWithId: async (sessionId: string, title: string): Promise<ChatSession> => {
      const currentTime = getCurrentTimestamp();
      const newSessionMeta: ChatSessionMetadata = {
        id: sessionId,
        title,
        createdAt: currentTime,
        updatedAt: currentTime,
        messageCount: 0,
      };

      // Create empty messages array for the new session
      const messagesStorage = getSessionMessagesStorage(sessionId);
      await messagesStorage.set([]);

      // Add session metadata to the index
      await chatSessionsMetaStorage.set(prevSessions => [...prevSessions, newSessionMeta]);

      return {
        ...newSessionMeta,
        messages: [],
      };
    },

    updateTitle: async (sessionId: string, title: string): Promise<ChatSessionMetadata> => {
      let updatedSessionMeta: ChatSessionMetadata | undefined;

      // Update the title and capture the updated session in a single pass
      await chatSessionsMetaStorage.set(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            // Create the updated session
            const updated = {
              ...session,
              title,
              updatedAt: getCurrentTimestamp(),
            };

            // Capture it for return value
            updatedSessionMeta = updated;

            return updated;
          }
          return session;
        });
      });

      // Check if we found and updated the session
      if (!updatedSessionMeta) {
        throw new Error('Session not found');
      }

      // Return the already captured metadata
      return updatedSessionMeta;
    },

    deleteSession: async (sessionId: string): Promise<void> => {
      // Remove session from metadata
      await chatSessionsMetaStorage.set(prevSessions => prevSessions.filter(session => session.id !== sessionId));

      // Remove the session's messages
      const messagesStorage = getSessionMessagesStorage(sessionId);
      await messagesStorage.set([]);
    },

    addMessage: async (sessionId: string, message: Message): Promise<ChatMessage> => {
      const sid = String(sessionId || '').trim();
      if (!sid) throw new Error('sessionId is required');

      const actor = (message as any)?.actor;
      const rawContent =
        typeof (message as any)?.content === 'string'
          ? (message as any).content
          : String((message as any)?.content ?? '');
      const ts =
        typeof (message as any)?.timestamp === 'number'
          ? (message as any).timestamp
          : Number((message as any)?.timestamp ?? Date.now());
      const timestamp = Number.isFinite(ts) ? ts : getCurrentTimestamp();
      const eventIdRaw = (message as any)?.eventId;
      const incomingEventId = eventIdRaw ? String(eventIdRaw).trim() : '';

      // Dedupe within a session across multiple persistence paths.
      const actorKey = String(actor || '');
      const contentKey = String(rawContent ?? '').trim();

      const messagesStorage = getSessionMessagesStorage(sid);
      let stored: ChatMessage | null = null;
      let didAdd = false;
      let finalCount = 0;

      await messagesStorage.set(prevMessages => {
        const prev = Array.isArray(prevMessages) ? prevMessages : [];
        finalCount = prev.length;

        // Primary: eventId-based dedupe (stable across systems)
        if (incomingEventId) {
          const existing = prev.find(m => String((m as any)?.eventId || '').trim() === incomingEventId);
          if (existing) {
            stored = existing as ChatMessage;
            return prev;
          }
        }

        // Fallback: exact actor+timestamp+trim(content)
        if (contentKey) {
          const existing = prev.find(m => {
            if (String((m as any)?.actor || '') !== actorKey) return false;
            if (Number((m as any)?.timestamp || 0) !== Number(timestamp)) return false;
            return String((m as any)?.content ?? '').trim() === contentKey;
          });
          if (existing) {
            stored = existing as ChatMessage;
            return prev;
          }
        }

        const id =
          typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${timestamp}-${actorKey}-${Math.random().toString(36).slice(2)}`;
        const newMessage: ChatMessage = {
          ...(message as any),
          actor,
          content: rawContent,
          timestamp,
          ...(incomingEventId ? { eventId: incomingEventId } : {}),
          id,
        } as ChatMessage;

        stored = newMessage;
        didAdd = true;
        finalCount = prev.length + 1;
        return [...prev, newMessage];
      });

      // Update/create session metadata ONLY when we actually added a message (or if metadata is missing).
      const now = getCurrentTimestamp();
      await chatSessionsMetaStorage.set(prevSessions => {
        const idx = prevSessions.findIndex(s => s.id === sid);
        if (idx !== -1) {
          if (!didAdd) return prevSessions;
          const updated = [...prevSessions];
          const session = prevSessions[idx];
          updated[idx] = {
            ...session,
            updatedAt: now,
            messageCount: (session.messageCount ?? 0) + 1,
          };
          return updated;
        }

        // Session metadata missing — create it so the session can be listed.
        const title =
          typeof rawContent === 'string'
            ? rawContent.substring(0, 50) + (rawContent.length > 50 ? '...' : '')
            : 'New Chat';
        const newSession: ChatSessionMetadata = {
          id: sid,
          title,
          createdAt: now,
          updatedAt: now,
          messageCount: didAdd ? 1 : Math.max(0, finalCount),
        };
        return [...prevSessions, newSession];
      });

      if (!stored) {
        // Should be unreachable, but keep the return type stable.
        stored = {
          ...(message as any),
          actor,
          content: rawContent,
          timestamp,
          ...(incomingEventId ? { eventId: incomingEventId } : {}),
          id:
            typeof crypto?.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${timestamp}-${actorKey}-${Math.random().toString(36).slice(2)}`,
        } as ChatMessage;
      }

      return stored;
    },

    deleteMessage: async (sessionId: string, messageId: string): Promise<void> => {
      // Get the messages storage for this session
      const messagesStorage = getSessionMessagesStorage(sessionId);

      // Get current messages to calculate the new count
      const currentMessages = await messagesStorage.get();
      const messageToDelete = currentMessages.find(msg => msg.id === messageId);

      if (!messageToDelete) return; // Message not found

      // Remove the message directly from the messages storage
      await messagesStorage.set(prevMessages => prevMessages.filter(msg => msg.id !== messageId));

      // Update the session's metadata (updatedAt timestamp and messageCount)
      await chatSessionsMetaStorage.set(prevSessions => {
        return prevSessions.map(session => {
          if (session.id === sessionId) {
            return {
              ...session,
              updatedAt: getCurrentTimestamp(),
              messageCount: Math.max(0, session.messageCount - 1),
            };
          }
          return session;
        });
      });
    },

    storeAgentStepHistory: async (sessionId: string, task: string, history: string): Promise<void> => {
      // Check if session exists
      const sessionsMeta = await chatSessionsMetaStorage.get();
      const sessionMeta = sessionsMeta.find(session => session.id === sessionId);
      if (!sessionMeta) {
        throw new Error(`Session with ID ${sessionId} not found`);
      }

      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      await agentStepHistoryStorage.set({
        task,
        history,
        timestamp: getCurrentTimestamp(),
      });
    },

    loadAgentStepHistory: async (sessionId: string): Promise<ChatAgentStepHistory | null> => {
      const agentStepHistoryStorage = getSessionAgentStepHistoryStorage(sessionId);
      const history = await agentStepHistoryStorage.get();
      if (!history || !history.task || !history.timestamp || history.history === '' || history.history === '[]')
        return null;
      return history;
    },

    // Persist/load per-message request summaries
    storeRequestSummaries: async (sessionId: string, summaries: Record<string, RequestSummary>): Promise<void> => {
      const key = `chat_request_summaries_${sessionId}`;
      const storage = createStorage<Record<string, RequestSummary>>(
        key,
        {},
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      await storage.set(summaries);
    },
    loadRequestSummaries: async (sessionId: string): Promise<Record<string, RequestSummary>> => {
      const key = `chat_request_summaries_${sessionId}`;
      const storage = createStorage<Record<string, RequestSummary>>(
        key,
        {},
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      return await storage.get();
    },

    // Persist/load per-message metadata
    // CRITICAL: This MERGES with existing metadata to prevent race conditions
    storeMessageMetadata: async (sessionId: string, metadata: Record<string, MessageMetadataValue>): Promise<void> => {
      const key = `chat_message_metadata_${sessionId}`;
      const storage = createStorage<Record<string, MessageMetadataValue>>(
        key,
        {},
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      // Merge with existing to prevent data loss from concurrent writes
      const existing = await storage.get();
      const merged: Record<string, MessageMetadataValue> = { ...existing };
      for (const [msgId, msgMeta] of Object.entries(metadata)) {
        if (msgId === '__sessionRootId') {
          // Always update the session root ID
          (merged as any).__sessionRootId = msgMeta;
        } else if (typeof msgMeta === 'object' && msgMeta !== null) {
          // For message metadata, merge trace items arrays
          const existingMeta = (existing as any)?.[msgId] || {};
          const newMeta = msgMeta as any;
          const existingTraceItems = Array.isArray(existingMeta.traceItems) ? existingMeta.traceItems : [];
          const newTraceItems = Array.isArray(newMeta.traceItems) ? newMeta.traceItems : [];
          // Deduplicate trace items by timestamp+actor+content
          const seen = new Set<string>();
          const mergedTraceItems: any[] = [];
          for (const item of [...existingTraceItems, ...newTraceItems]) {
            const key = `${item.timestamp}-${item.actor}-${item.content}`;
            if (!seen.has(key)) {
              seen.add(key);
              mergedTraceItems.push(item);
            }
          }
          // Sort by timestamp
          mergedTraceItems.sort((a, b) => a.timestamp - b.timestamp);
          (merged as any)[msgId] = {
            ...existingMeta,
            ...newMeta,
            traceItems: mergedTraceItems.length > 0 ? mergedTraceItems : undefined,
          };
        } else {
          (merged as any)[msgId] = msgMeta;
        }
      }
      await storage.set(merged);
    },
    loadMessageMetadata: async (sessionId: string): Promise<Record<string, MessageMetadataValue>> => {
      const key = `chat_message_metadata_${sessionId}`;
      const storage = createStorage<Record<string, MessageMetadataValue>>(
        key,
        {},
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      return await storage.get();
    },

    // Persist/load aggregated per-session statistics
    storeSessionStats: async (sessionId: string, stats: SessionStats): Promise<void> => {
      const key = `chat_session_stats_${sessionId}`;
      const storage = createStorage<SessionStats>(
        key,
        {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalLatency: 0,
          totalCost: 0,
          avgLatencyPerRequest: 0,
        },
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      await storage.set(stats);
    },
    loadSessionStats: async (sessionId: string): Promise<SessionStats | null> => {
      const key = `chat_session_stats_${sessionId}`;
      const storage = createStorage<SessionStats>(
        key,
        {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalLatency: 0,
          totalCost: 0,
          avgLatencyPerRequest: 0,
        },
        { storageEnum: StorageEnum.Local, liveUpdate: true },
      );
      const s = await storage.get();
      if (!s) return null;
      return s;
    },
  };
}

// Export the storage instance for direct use
export const chatHistoryStore = createChatHistoryStorage();
