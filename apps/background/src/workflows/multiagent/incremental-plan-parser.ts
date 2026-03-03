import type { Subtask, SubtaskId } from './multiagent-types';

/**
 * Incrementally extracts root subtasks (dependencies: []) from a streaming
 * JSON plan response. Feeds text chunks and emits complete subtask objects
 * the moment their closing brace arrives in the stream.
 */
export class IncrementalPlanParser {
  private buffer = '';
  private emittedIds = new Set<SubtaskId>();

  /** Append a streamed chunk; returns any newly-complete root subtasks. */
  feed(chunk: string): Subtask[] {
    this.buffer += chunk;
    const arrayStart = this.findSubtasksArrayStart();
    if (arrayStart < 0) return [];

    const results: Subtask[] = [];
    for (const objStr of extractCompleteObjects(this.buffer, arrayStart)) {
      try {
        const raw = JSON.parse(objStr);
        const id = Number.parseInt(String(raw.id), 10);
        if (!Number.isFinite(id) || this.emittedIds.has(id)) continue;

        const deps = (Array.isArray(raw.dependencies) ? raw.dependencies : [])
          .map((d: any) => Number.parseInt(String(d), 10))
          .filter((n: number) => Number.isFinite(n));
        if (deps.length > 0) continue;

        this.emittedIds.add(id);
        results.push(normalizeRawSubtask(raw, id));
      } catch {
        /* incomplete JSON object — not ready yet */
      }
    }
    return results;
  }

  /** Full accumulated text for final plan parsing. */
  getFullContent(): string {
    return this.buffer;
  }

  private findSubtasksArrayStart(): number {
    const match = this.buffer.match(/"subtasks"\s*:\s*\[/);
    return match?.index !== undefined ? match.index + match[0].length : -1;
  }
}

/**
 * Scans text from `start` and yields each top-level {...} object string.
 * Handles strings (with escaped quotes) so braces inside strings are ignored.
 */
function extractCompleteObjects(text: string, start: number): string[] {
  const objects: string[] = [];
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let objStart = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        objects.push(text.slice(objStart, i + 1));
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  return objects;
}

function normalizeRawSubtask(raw: any, id: number): Subtask {
  return {
    id,
    title: String(raw.title || `Step ${id}`).trim(),
    prompt: String(raw.prompt || '').trim(),
    startCriteria: [],
    noBrowse: !!(raw.no_browse || raw.noBrowse),
    suggestedUrls: coerceStringArray(raw.suggested_urls ?? raw.suggestedUrls),
    suggestedSearchQueries: coerceStringArray(raw.suggested_search_queries ?? raw.suggestedSearchQueries),
  };
}

function coerceStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.map(String) : [];
}

/** Build a dispatch prompt for a root subtask (no prior outputs needed). */
export function buildRootSubtaskPrompt(s: Subtask): string {
  let prompt = `\nYour task is to ${s.title}.\nSpecifically, you must: ${s.prompt}`;
  if (s.suggestedUrls?.length) {
    prompt += `\n\nSuggested URLs:\n${s.suggestedUrls.map(u => `- ${u}`).join('\n')}`;
  } else if (s.suggestedSearchQueries?.length) {
    prompt += `\n\nSuggested search queries:\n${s.suggestedSearchQueries.map(q => `- ${q}`).join('\n')}`;
  }
  return prompt;
}
