// Test instrumentation - only active when __TEST__=true
// This module provides logging hooks that are no-ops in production builds
// All logging logic is inlined to avoid external package dependencies

type LogStatus = 'call' | 'success' | 'error';

interface TestLogEntry {
  event: string;
  type: string;
  status: LogStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

const MAX_LOGS = 10000;
const logs: TestLogEntry[] = [];

// Expose logs on globalThis for direct access from test harness
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__testLogs = logs;
}

// Handler registry for test invocation
type MessageHandler = (
  message: { type: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const testHandlers: Map<string, MessageHandler> = new Map();

export function registerTestHandler(type: string, handler: MessageHandler): void {
  if (!isTestMode()) return;
  testHandlers.set(type, handler);
}

// Expose test handler invocation on globalThis
if (typeof globalThis !== 'undefined' && isTestMode()) {
  (globalThis as any).__testInvokeHandler = async (message: { type: string; [key: string]: unknown }) => {
    return new Promise((resolve, reject) => {
      const handler = testHandlers.get(message.type);
      if (!handler) {
        reject(new Error(`No handler registered for type: ${message.type}`));
        return;
      }
      const fakeSender: chrome.runtime.MessageSender = {};
      const sendResponse = (response?: unknown) => resolve(response);
      try {
        const result = handler(message, fakeSender, sendResponse);
        // If handler returns false or undefined synchronously, it means no async response
        if (result !== true) {
          resolve(undefined);
        }
      } catch (e) {
        reject(e);
      }
    });
  };
}

export function isTestMode(): boolean {
  return process.env.__TEST__ === 'true';
}

function addLog(entry: Omit<TestLogEntry, 'timestamp'>): void {
  if (!isTestMode()) return;
  if (logs.length >= MAX_LOGS) logs.shift();
  logs.push({ ...entry, timestamp: Date.now() });
}

export function logMessageCall(type: string, input?: unknown): void {
  addLog({ event: 'message_handler', type, status: 'call', input });
}

export function logMessageSuccess(type: string, output?: unknown): void {
  addLog({ event: 'message_handler', type, status: 'success', output });
}

export function logMessageError(type: string, error: string): void {
  addLog({ event: 'message_handler', type, status: 'error', error });
}

export function logPortMessage(
  portName: string,
  messageType: string,
  status: LogStatus,
  data?: { input?: unknown; output?: unknown; error?: string },
): void {
  addLog({ event: 'port_message', type: messageType, status, ...data, meta: { portName } });
}

export function logStorageRead(key: string, value: unknown): void {
  addLog({ event: 'storage_read', type: key, status: 'success', output: value });
}

export function logStorageWrite(key: string, value: unknown): void {
  addLog({ event: 'storage_write', type: key, status: 'success', input: value });
}

export function logChromeAPI(
  api: string,
  method: string,
  status: LogStatus,
  data?: { input?: unknown; output?: unknown; error?: string },
): void {
  addLog({ event: 'chrome_api', type: `${api}.${method}`, status, ...data });
}

export function logUIState(component: string, props: Record<string, unknown>): void {
  addLog({ event: 'ui_state', type: component, status: 'success', output: props });
}

export function getTestLogs(): TestLogEntry[] {
  return [...logs];
}

export function clearTestLogs(): void {
  logs.length = 0;
}

export function getTestLogsJSON(): string {
  return JSON.stringify({ logs });
}
