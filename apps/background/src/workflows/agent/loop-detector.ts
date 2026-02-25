const EXEMPT = new Set(['wait', 'done', 'go_back', 'cache_content']);

const DEFAULT_WINDOW = 20;
const CYCLE_WINDOW = 6;
const MAX_FINGERPRINTS = 5;

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonicalize(name: string, params: Record<string, unknown>): string {
  switch (name) {
    case 'click_element':
      return `click:${params.index}`;
    case 'click_selector':
      return `csclick:${params.selector}`;
    case 'find_and_click_text':
      return `fclick:${String(params.text ?? '').toLowerCase()}`;
    case 'input_text':
      return `type:${params.index}:${String(params.text ?? '')
        .trim()
        .toLowerCase()}`;
    case 'go_to_url':
      return `nav:${params.url}`;
    case 'search_google':
      return `search:${String(params.query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .sort()
        .join(' ')}`;
    default: {
      if (name.startsWith('scroll') || name === 'next_page' || name === 'previous_page') {
        const key = params.index ?? params.percent ?? params.text ?? params.selector ?? 'page';
        return `scroll:${name}:${key}`;
      }
      const sorted = Object.keys(params)
        .filter(k => k !== 'intent')
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join(',');
      return `${name}:${sorted}`;
    }
  }
}

export class LoopDetector {
  private actionKeys: string[] = [];
  private stepSigs: string[] = [];
  private fingerprints: string[] = [];
  private consecutiveStagnant = 0;
  private readonly windowSize: number;

  constructor(windowSize = DEFAULT_WINDOW) {
    this.windowSize = windowSize;
  }

  recordActions(actions: Record<string, unknown>[]): void {
    const keys: string[] = [];
    for (const action of actions) {
      const name = Object.keys(action)[0];
      if (!name || EXEMPT.has(name)) continue;
      const params = (action[name] as Record<string, unknown>) ?? {};
      keys.push(canonicalize(name, params));
    }
    if (keys.length === 0) return;

    this.actionKeys.push(...keys);
    if (this.actionKeys.length > this.windowSize) {
      this.actionKeys = this.actionKeys.slice(-this.windowSize);
    }

    const sig = [...keys].sort().join('|');
    this.stepSigs.push(sig);
    if (this.stepSigs.length > CYCLE_WINDOW) {
      this.stepSigs = this.stepSigs.slice(-CYCLE_WINDOW);
    }
  }

  recordPageState(url: string, elementTreeText: string): void {
    const fp = `${url}|${fnv1a(elementTreeText)}`;
    const prev = this.fingerprints.length > 0 ? this.fingerprints[this.fingerprints.length - 1] : null;
    this.consecutiveStagnant = fp === prev ? this.consecutiveStagnant + 1 : 0;

    this.fingerprints.push(fp);
    if (this.fingerprints.length > MAX_FINGERPRINTS) {
      this.fingerprints = this.fingerprints.slice(-MAX_FINGERPRINTS);
    }
  }

  getNudge(): string | null {
    const parts: string[] = [];

    // Signal 1: action repetition
    if (this.actionKeys.length > 0) {
      const counts = new Map<string, number>();
      for (const key of this.actionKeys) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const max = Math.max(...counts.values());
      if (max >= 5) {
        let msg =
          `Heads up: you have repeated a similar action ${max} times in the last ${this.actionKeys.length} actions. ` +
          'If this is intentional and making progress, carry on. If not, it might be worth reconsidering your approach.';
        if (max >= 12) msg += ' A different approach might get you there faster.';
        else if (max >= 8) msg += ' Are you still making progress with each attempt?';
        parts.push(msg);
      }
    }

    // Signal 2: page stagnation
    if (this.consecutiveStagnant >= 5) {
      parts.push(
        `The page content has not changed across ${this.consecutiveStagnant} consecutive actions. ` +
          'Your actions might not be having the intended effect.',
      );
    }

    // Signal 3: step cycling
    if (this.stepSigs.length >= CYCLE_WINDOW) {
      const unique = new Set(this.stepSigs).size;
      if (unique <= 2) {
        parts.push(
          'Heads up: you appear to be repeating the same sequence of actions. ' +
            'If this is intentional and making progress, carry on. If not, it might be worth trying a different approach.',
        );
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
