export interface ErrorEntry {
  timestamp: number;
  sessionId: string;
  taskId?: string;
  workerId?: string | number;
  source?: string;
  message: string;
  stack?: string;
}

class ErrorLog {
  private entries: ErrorEntry[] = [];

  add(entry: Partial<ErrorEntry> & { message: string; sessionId: string }): void {
    try {
      const e: ErrorEntry = {
        timestamp: Date.now(),
        sessionId: entry.sessionId,
        taskId: entry.taskId,
        workerId: entry.workerId,
        source: entry.source,
        message: entry.message,
        stack: entry.stack,
      };
      this.entries.push(e);
    } catch {}
  }

  getAll(): ErrorEntry[] {
    return this.entries.slice();
  }

  getBySession(sessionId: string): ErrorEntry[] {
    return this.entries.filter(e => String(e.sessionId) === String(sessionId));
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.entries = [];
      return;
    }
    this.entries = this.entries.filter(e => String(e.sessionId) !== String(sessionId));
  }
}

export const errorLog = new ErrorLog();


