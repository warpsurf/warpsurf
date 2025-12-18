/**
 * Generate a new unique task ID using timestamp and random string
 * Format: task-<timestamp>-<random>
 */
export function generateNewTaskId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9); // 7 random chars
  return `task-${timestamp}-${random}`;
}

export function generateTimestamp(): number {
  return Date.now();
}

