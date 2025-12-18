class WorkflowLogger {
  private taskNumber: number = 0;
  private currentWorkerIndex: number | null = null;
  private currentTaskNumber: number = 0;

  setWorkerIndex(index: number | null): void {
    this.currentWorkerIndex = index;
  }

  taskReceived(task: string, workflowType?: string): number {
    this.taskNumber++;
    this.currentTaskNumber = this.taskNumber;
    let workflowInfo = '';
    if (workflowType && workflowType !== 'auto') {
      workflowInfo = workflowType === 'agent' && this.currentWorkerIndex !== null
        ? ` [Web Agent ${this.currentWorkerIndex}]`
        : ` [${this.formatWorkflow(workflowType)}]`;
    }
    console.info(`[Task #${this.taskNumber}]${workflowInfo}: "${this.truncate(task, 60)}"`);
    return this.taskNumber;
  }

  autoRouting(action: string, confidence: number): void {
    const workflowName = this.formatWorkflow(action);
    const confidencePercent = Math.round(confidence * 100);
    console.info(`[Auto] Routed to ${workflowName} (${confidencePercent}% confidence)`);
  }

  workflowStart(workflow: string): void {
    if (workflow === 'agent' && this.currentWorkerIndex !== null) return;
    console.info(`[${this.formatWorkflow(workflow)} Workflow] Started`);
  }

  workflowStep(step: number, maxSteps: number, brief?: string): void {
    const progress = brief ? `: ${this.truncate(brief, 40)}` : '';
    const context = this.currentWorkerIndex !== null
      ? ` [Task #${this.taskNumber}, Web Agent ${this.currentWorkerIndex}]`
      : this.taskNumber > 0 ? ` [Task #${this.taskNumber}]` : '';
    console.info(`[Step] ${step}/${maxSteps}${context}${progress}`);
  }

  taskComplete(durationMs: number, cost: number, tokens?: number, taskNum?: number): void {
    const duration = (durationMs / 1000).toFixed(1);
    const costStr = cost > 0 ? `, $${cost.toFixed(4)}` : '';
    const tokensStr = tokens ? `, ${tokens.toLocaleString()} tokens` : '';
    const taskLabel = taskNum ? `[Task #${taskNum}]` : `[Task #${this.currentTaskNumber}]`;
    console.info(`${taskLabel} Complete (${duration}s${costStr}${tokensStr})`);
  }

  taskFailed(reason: string, taskNum?: number): void {
    const taskLabel = taskNum ? `[Task #${taskNum}]` : `[Task #${this.currentTaskNumber}]`;
    console.info(`${taskLabel} Failed: ${this.truncate(reason, 80)}`);
  }

  taskCancelled(taskNum?: number): void {
    const taskLabel = taskNum ? `[Task #${taskNum}]` : `[Task #${this.currentTaskNumber}]`;
    console.info(`${taskLabel} Cancelled by user`);
  }

  workerCreated(index: number, total: number, task: string): void {
    console.info(`    Worker ${index}/${total}: "${this.truncate(task, 40)}"`);
  }

  extensionInitialized(pricedModels: number, latencyModels: number, registryModels: number = 0, errors: number = 0): void {
    if (errors > 0) {
      console.info(`[Warpsurf] Extension initialized (${pricedModels} priced, ${registryModels} registry, ${errors} errors)`);
    } else {
      console.info(`[Warpsurf] Extension initialized (models: ${pricedModels} priced, ${latencyModels} latency, ${registryModels} registry)`);
    }
  }

  private formatWorkflow(type: string): string {
    const map: Record<string, string> = {
      'auto': 'Auto',
      'chat': 'Chat',
      'search': 'Search',
      'agent': 'Agent',
      'multiagent': 'Multi-Agent',
    };
    return map[type] || type;
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}

export const workflowLogger = new WorkflowLogger();

