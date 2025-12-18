/**
 * Type-safe message protocol between background and panel
 */

// Background → Panel messages
export type BackgroundMessage = 
  | { type: 'execution'; actor: string; state: string; data: ExecutionData; timestamp: number }
  | { type: 'tab-mirror-update'; data: MirrorData }
  | { type: 'tab-mirror-batch'; data: MirrorData[] }
  | { type: 'workflow_graph_update'; sessionId: string; graph: unknown }
  | { type: 'workflow_progress'; sessionId: string; actor: string; message: string; workerId?: number }
  | { type: 'workflow_ended'; sessionId: string; ok: boolean; error?: string; summary?: unknown }
  | { type: 'token_log'; data: unknown[] }
  | { type: 'error'; error: string }
  | { type: 'success' }
  | { type: 'heartbeat_ack' };

// Panel → Background messages
export type PanelMessage =
  | { type: 'new_task'; task: string; agentType: string; tabId: number; taskId: string }
  | { type: 'follow_up_task'; task: string; agentType?: string; taskId: string }
  | { type: 'cancel_task'; taskId: string; sessionId: string }
  | { type: 'pause_task' }
  | { type: 'resume_task' }
  | { type: 'approve_estimation'; sessionId: string; selectedModel?: string; estimation?: any }
  | { type: 'cancel_estimation'; sessionId: string }
  | { type: 'get_token_log'; taskId: string }
  | { type: 'get_error_log'; sessionId: string }
  | { type: 'close_task_tabs'; taskId: string }
  | { type: 'close_all_tabs_for_session'; sessionId: string }
  | { type: 'get-tab-mirror' }
  | { type: 'heartbeat' }
  | { type: 'panel_opened' };

// Interfaces for complex data
export interface ExecutionData {
  [key: string]: unknown;
}

export interface MirrorData {
  tabId: number;
  screenshot?: string;
  url?: string;
  [key: string]: unknown;
}

// Type guards
export function isBackgroundMessage(msg: unknown): msg is BackgroundMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

export function isPanelMessage(msg: unknown): msg is PanelMessage {
  return typeof msg === 'object' && msg !== null && 'type' in msg;
}

