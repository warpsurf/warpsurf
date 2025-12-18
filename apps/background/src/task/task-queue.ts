export class TaskQueue {
  private queue: string[] = [];
  private running: Set<string> = new Set();
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  }

  enqueue(taskId: string): void {
    this.queue.push(taskId);
  }

  dequeue(): string | undefined {
    return this.queue.shift();
  }

  remove(taskId: string): void {
    const idx = this.queue.indexOf(taskId);
    if (idx > -1) this.queue.splice(idx, 1);
  }

  markRunning(taskId: string): void {
    this.running.add(taskId);
  }

  markCompleted(taskId: string): void {
    this.running.delete(taskId);
  }

  hasCapacity(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(max));
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getPendingIds(): string[] {
    return [...this.queue];
  }

  getRunningIds(): string[] {
    return Array.from(this.running);
  }
}

