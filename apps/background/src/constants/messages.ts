/**
 * Port names for Chrome extension messaging
 */
export const PORT_NAMES = {
  SIDE_PANEL: 'side-panel-connection',
  DASHBOARD: 'dashboard',
} as const;

/**
 * Common message type constants
 */
export const MESSAGE_TYPES = {
  NEW_TASK: 'new_task',
  FOLLOW_UP_TASK: 'follow_up_task',
  CANCEL_TASK: 'cancel_task',
  PAUSE_TASK: 'pause_task',
  RESUME_TASK: 'resume_task',
  WORKFLOW_PROGRESS: 'workflow_progress',
  WORKFLOW_ENDED: 'workflow_ended',
  APPROVE_ESTIMATION: 'approve_estimation',
  CANCEL_ESTIMATION: 'cancel_estimation',
  GET_TAB_MIRROR: 'get-tab-mirror',
  TAB_MIRROR_UPDATE: 'tab-mirror-update',
  TAB_MIRROR_BATCH: 'tab-mirror-batch',
  GET_TOKEN_LOG: 'get_token_log',
  GET_ERROR_LOG: 'get_error_log',
  GET_AGENT_LOG: 'get_agent_log',
} as const;

