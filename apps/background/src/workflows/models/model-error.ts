export type ModelErrorKind =
  | 'auth_invalid_key'
  | 'auth_missing_key'
  | 'auth_forbidden'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider'
  | 'unknown';

export type TypedModelErrorData = {
  kind: ModelErrorKind;
  provider: string;
  model: string;
  statusCode?: number;
  retryable: boolean;
  userMessage: string;
  rawMessage: string;
};

export class TypedModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly provider: string;
  readonly model: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly rawMessage: string;

  constructor(data: TypedModelErrorData) {
    super(data.userMessage);
    this.name = 'TypedModelError';
    this.kind = data.kind;
    this.provider = data.provider;
    this.model = data.model;
    this.statusCode = data.statusCode;
    this.retryable = data.retryable;
    this.rawMessage = data.rawMessage;
  }
}

const INVALID_KEY_MARKERS = [
  'invalid api key',
  'invalid_api_key',
  'incorrect api key',
  'api key is invalid',
  'api key not valid', // Gemini format
  'bad api key',
  'authentication_error',
];

function readStatusCode(error: any): number | undefined {
  const direct = Number(error?.status ?? error?.statusCode ?? error?.code);
  if (Number.isFinite(direct) && direct >= 100 && direct <= 599) return direct;
  const nested = Number(error?.response?.status ?? error?.error?.status);
  if (Number.isFinite(nested) && nested >= 100 && nested <= 599) return nested;
  return undefined;
}

function isMissingApiKey(message: string): boolean {
  return (
    message.includes('api key') &&
    (message.includes('missing') ||
      message.includes('not found') ||
      message.includes('required') ||
      message.includes('must be provided'))
  );
}

export function normalizeModelError(error: unknown, provider: string, model: string): TypedModelError {
  if (error instanceof TypedModelError) return error;

  const rawMessage = String((error as any)?.message || error || 'Unknown error');
  const message = rawMessage.toLowerCase();
  const statusCode = readStatusCode(error as any);

  let kind: ModelErrorKind = 'unknown';
  let retryable = false;

  if (statusCode === 401 || INVALID_KEY_MARKERS.some(marker => message.includes(marker))) {
    kind = 'auth_invalid_key';
  } else if (statusCode === 403 || message.includes('forbidden') || message.includes('permission')) {
    kind = 'auth_forbidden';
  } else if (isMissingApiKey(message)) {
    kind = 'auth_missing_key';
  } else if (statusCode === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    kind = 'rate_limit';
    retryable = true;
  } else if (message.includes('timed out') || message.includes('timeout')) {
    kind = 'timeout';
    retryable = true;
  } else if (
    message.includes('network') ||
    message.includes('econn') ||
    message.includes('enotfound') ||
    message.includes('fetch failed') ||
    message.includes('connection')
  ) {
    kind = 'network';
    retryable = true;
  } else if ((statusCode && statusCode >= 500) || message.includes('server error') || message.includes('internal')) {
    kind = 'provider';
    retryable = true;
  }

  return new TypedModelError({
    kind,
    provider,
    model,
    statusCode,
    retryable,
    rawMessage,
    userMessage: rawMessage,
  });
}

/** Check if an error should NOT be retried (auth errors, etc.) */
export function isNonRetryableError(error: unknown): boolean {
  if (error instanceof TypedModelError) {
    return !error.retryable;
  }
  // Check raw error for auth indicators
  const msg = String((error as any)?.message || error || '').toLowerCase();
  const status = Number((error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.code);
  if (status === 401 || status === 403) return true;
  if (INVALID_KEY_MARKERS.some(marker => msg.includes(marker))) return true;
  if (msg.includes('forbidden') || msg.includes('permission')) return true;
  return false;
}

export function toUIErrorPayload(error: unknown, fallback = 'Request failed') {
  if (error instanceof TypedModelError) {
    return {
      message: error.message,
      error: {
        kind: error.kind,
        provider: error.provider,
        model: error.model,
        statusCode: error.statusCode,
        retryable: error.retryable,
        userMessage: error.message,
        rawMessage: error.rawMessage,
      },
    };
  }
  const message = String((error as any)?.message || error || fallback);
  return {
    message,
    error: {
      kind: 'unknown' as const,
      retryable: false,
      userMessage: message,
      rawMessage: message,
    },
  };
}
