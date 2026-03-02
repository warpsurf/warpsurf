import { createLogger } from '@src/log';
import type { TaskManager } from '@src/task/task-manager';
import type { StructuredOutput } from '../workflow-events';

const logger = createLogger('Sailor');

export interface SailorResult {
  ok: boolean;
  error?: string;
  output?: StructuredOutput;
}

/**
 * A Sailor executes individual subtasks using a browser agent.
 * Thin wrapper around TaskManager's worker session API.
 */
export class Sailor {
  private taskManager: TaskManager;
  private parentSessionId: string;
  private taskContext: string;

  constructor(taskManager: TaskManager, parentSessionId: string, taskContext: string) {
    this.taskManager = taskManager;
    this.parentSessionId = parentSessionId;
    this.taskContext = taskContext;
  }

  async createSession(sailorId: number): Promise<string> {
    const label = `Sailor ${sailorId}`;
    logger.info(`Creating session for ${label}`);
    return this.taskManager.createWorkerSession('', label, this.parentSessionId, this.taskContext, sailorId);
  }

  async dispatch(sessionId: string, prompt: string, subtaskId: number, targetTabIds?: number[]): Promise<SailorResult> {
    const startTime = Date.now();
    const res = await this.taskManager.runWorkerSubtask(
      sessionId,
      prompt,
      targetTabIds?.length ? targetTabIds : undefined,
      subtaskId,
    );

    if (!res.ok) {
      return { ok: false, error: res.error || 'Subtask failed' };
    }

    // Parse structured output
    let raw: any;
    if (res.outputText) {
      const trimmed = res.outputText.trim();
      const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
      const candidate = fence ? fence[1] : trimmed;
      if (
        (candidate.startsWith('[') && candidate.endsWith(']')) ||
        (candidate.startsWith('{') && candidate.endsWith('}'))
      ) {
        try {
          raw = JSON.parse(candidate);
        } catch {}
      }
    }

    return {
      ok: true,
      output: {
        text: res.outputText || '',
        raw,
        tabIds: res.tabIds || [],
        duration: Date.now() - startTime,
        stepsUsed: 0,
      },
    };
  }

  async cancel(sessionId: string): Promise<void> {
    try {
      await this.taskManager.cancelTask(sessionId);
    } catch {}
    try {
      await this.taskManager.endWorkerSession(sessionId, 'cancelled');
    } catch {}
  }

  async endSession(sessionId: string, status: 'completed' | 'cancelled' | 'error'): Promise<void> {
    try {
      await this.taskManager.endWorkerSession(sessionId, status);
    } catch {}
  }
}
