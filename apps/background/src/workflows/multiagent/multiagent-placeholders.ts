import type { PriorOutput } from './multiagent-types';

/** Simple template replacement allowing both <name> and {{name}} placeholders. */
export function replacePlaceholders(template: string, values: Record<string, string>): string {
	let out = template;
	for (const [key, val] of Object.entries(values)) {
		const patterns = [
			new RegExp(String.raw`<${key}>`, 'g'),
			new RegExp(String.raw`\{\{\s*${key}\s*\}\}`, 'g'),
		];
		for (const p of patterns) out = out.replace(p, val);
	}
	return out;
}

/**
 * Build the repeated prior-output sections for prerequisite tasks.
 * Each entry format:
 * Here is the output from a previous task entitled <task_title>:
 *
 * <output>
 *
 * this task was carried out in tabs: <TabIDs>
 */
export function buildPriorOutputsSection(priors: PriorOutput[], placeholderStyle: 'angle' | 'braces' = 'angle'): string {
	const lines: string[] = [];
	const mk = (name: string) => placeholderStyle === 'angle' ? `<${name}>` : `{{${name}}}`;
	for (const p of priors) {
		const tabs = (p.tabIds || []).join(', ');
		// Prefer structured JSON if available; otherwise include a compact text snippet.
		const jsonStr = p.rawJson !== undefined ? JSON.stringify(p.rawJson, null, 2) : tryStringifyJson(p.output);
		const hasJson = jsonStr && jsonStr !== 'null';
		const body: string[] = [];
		body.push(`Here is the output from a previous task entitled ${mk('task_title')}:`);
		body.push('');
		if (hasJson) {
			body.push('For machine-readability, here is the output in strict JSON:');
			body.push(mk('output_json'));
		} else {
			const out = (p.output || '').trim();
			const compact = out.length > 600 ? `${out.slice(0, 600)}…` : out;
			body.push(compact || 'null');
		}
		if (tabs.length > 0) {
			body.push('');
			body.push(`this task was carried out in tabs: ${mk('TabIDs')}`);
		}
		const filled = replacePlaceholders(body.join('\n'), {
			task_title: p.title || '',
			TabIDs: tabs,
			output_json: hasJson ? jsonStr : 'null',
		});
		lines.push(filled);
	}
	return lines.join('\n\n');
}

function tryStringifyJson(text: string | undefined): string {
	if (!text) return 'null';
	try {
		const parsed = JSON.parse(text);
		return JSON.stringify(parsed, null, 2);
	} catch {}
	// Try to recover inline arrays/objects from simple patterns
	const trimmed = String(text).trim();
	if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
		return trimmed;
	}
	return 'null';
}

