export type ValueOf<T> = T[keyof T];

export enum EventType {
  EXECUTION = 'execution',
}

export enum ExecutionState {
  // Task level states
  TASK_START = 'task.start',
  TASK_OK = 'task.ok',
  TASK_FAIL = 'task.fail',
  TASK_PAUSE = 'task.pause',
  TASK_RESUME = 'task.resume',
  TASK_CANCEL = 'task.cancel',

  // Step level states
  STEP_START = 'step.start',
  STEP_OK = 'step.ok',
  STEP_FAIL = 'step.fail',
  STEP_CANCEL = 'step.cancel',
  STEP_STREAMING = 'step.streaming',

  // Action/Tool level states
  ACT_START = 'act.start',
  ACT_OK = 'act.ok',
  ACT_FAIL = 'act.fail',

  // Tab level states
  TAB_CREATED = 'tab.created',
  TAB_CLOSED = 'tab.closed',
  TAB_NAVIGATED = 'tab.navigated',
  TAB_GROUP_UPDATED = 'tab.group_updated',

  // Estimation level states
  ESTIMATION_PENDING = 'estimation.pending',
  ESTIMATION_APPROVED = 'estimation.approved',
  ESTIMATION_CANCELLED = 'estimation.cancelled',
}
