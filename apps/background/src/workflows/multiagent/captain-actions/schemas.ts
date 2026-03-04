import { z } from 'zod';

export interface CaptainActionSchema {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  promptExample?: string;
}

const subtaskSpec = z.object({
  title: z.string(),
  prompt: z.string(),
  dependencies: z.array(z.number().int()),
  is_final: z.boolean().optional(),
  no_browse: z.boolean().optional(),
  suggested_urls: z.array(z.string()).optional(),
  suggested_search_queries: z.array(z.string()).optional(),
});

const revisedSubtaskSpec = z.object({
  temp_id: z.string().optional().describe('short label for inter-dependency references (e.g., "search", "r1")'),
  title: z.string(),
  prompt: z.string(),
  dependencies: z.array(z.union([z.number().int(), z.string()])),
  is_final: z.boolean().optional(),
  no_browse: z.boolean().optional(),
  suggested_urls: z.array(z.string()).optional(),
  suggested_search_queries: z.array(z.string()).optional(),
});

export const dispatchSubtaskSchema: CaptainActionSchema = {
  name: 'dispatch_subtask',
  description: 'Dispatch a ready subtask (optionally with a refined prompt)',
  schema: z.object({
    subtask_id: z.number().int().describe('id'),
    refined_prompt: z.string().optional().describe('optional improved prompt'),
  }),
};

export const cancelSubtaskSchema: CaptainActionSchema = {
  name: 'cancel_subtask',
  description: 'Cancel a running or pending subtask',
  schema: z.object({
    subtask_id: z.number().int().describe('id'),
    reason: z.string().describe('why'),
  }),
};

export const retrySubtaskSchema: CaptainActionSchema = {
  name: 'retry_subtask',
  description: 'Retry a failed subtask with an optional modified prompt',
  schema: z.object({
    subtask_id: z.number().int().describe('id'),
    modified_prompt: z.string().optional().describe('optional new prompt'),
  }),
};

export const skipSubtaskSchema: CaptainActionSchema = {
  name: 'skip_subtask',
  description: 'Permanently skip a failed/stuck subtask so downstream tasks can proceed without it',
  schema: z.object({
    subtask_id: z.number().int().describe('id'),
    reason: z.string().describe('why skipping is acceptable'),
  }),
};

export const addSubtaskSchema: CaptainActionSchema = {
  name: 'add_subtask',
  description: 'Add a new subtask to the plan',
  schema: z.object({
    subtask: subtaskSpec,
    after_dependencies: z.array(z.number().int()),
  }),
  promptExample:
    '{"type": "add_subtask", "subtask": {"title": "...", "prompt": "...", "dependencies": [<ids>]}, "after_dependencies": [<ids>]}',
};

export const modifySubtaskSchema: CaptainActionSchema = {
  name: 'modify_subtask',
  description: "Change a pending subtask's prompt, title, or dependencies",
  schema: z.object({
    subtask_id: z.number().int().describe('id'),
    new_prompt: z.string().optional().describe('prompt'),
    new_title: z.string().optional().describe('title'),
    no_browse: z.boolean().optional().describe('bool'),
    new_dependencies: z.array(z.number().int()).optional().describe('replace dependency list with these subtask IDs'),
  }),
};

export const modifyPlanSchema: CaptainActionSchema = {
  name: 'modify_plan',
  description: 'Replace all pending subtasks with a revised set (use temp_id strings for inter-dependencies)',
  schema: z.object({
    revised_subtasks: z.array(revisedSubtaskSpec),
    reason: z.string().describe('why'),
  }),
  promptExample:
    '{"type": "modify_plan", "revised_subtasks": [{"temp_id": "search", "title": "Search eBay", "prompt": "...", "dependencies": []}, {"title": "Research 1", "prompt": "...", "dependencies": ["search"]}], "reason": "<why>"}',
};

export const launchSpeculativeSchema: CaptainActionSchema = {
  name: 'launch_speculative',
  description: 'Launch parallel alternative approaches for one goal',
  schema: z.object({
    goal_id: z.string().describe('unique goal name'),
    alternatives: z.array(subtaskSpec),
  }),
  promptExample:
    '{"type": "launch_speculative", "goal_id": "<goal>", "alternatives": [{"title": "...", "prompt": "...", "dependencies": [...]}]}',
};

export const resolveSpeculativeSchema: CaptainActionSchema = {
  name: 'resolve_speculative',
  description: 'Declare a winner in a speculative race, cancel alternatives',
  schema: z.object({
    goal_id: z.string().describe('goal name'),
    winner_id: z.number().int().describe('winning subtask id'),
  }),
};

export const completeWorkflowSchema: CaptainActionSchema = {
  name: 'complete_workflow',
  description:
    'End the workflow early with partial results. Use when remaining tasks are failing, stuck, or taking too long and available results are sufficient',
  schema: z.object({
    reason: z.string().describe('why completing early, what was not possible'),
  }),
};

export const abortWorkflowSchema: CaptainActionSchema = {
  name: 'abort_workflow',
  description: 'Terminate the entire workflow (irrecoverable failure only)',
  schema: z.object({
    reason: z.string().describe('why'),
  }),
};

export const pauseWorkflowSchema: CaptainActionSchema = {
  name: 'pause_workflow',
  description: 'Pause the entire workflow for user review',
  schema: z.object({
    reason: z.string().describe('why pausing'),
  }),
};

export const allCaptainActionSchemas: CaptainActionSchema[] = [
  dispatchSubtaskSchema,
  cancelSubtaskSchema,
  retrySubtaskSchema,
  skipSubtaskSchema,
  addSubtaskSchema,
  modifySubtaskSchema,
  modifyPlanSchema,
  launchSpeculativeSchema,
  resolveSpeculativeSchema,
  completeWorkflowSchema,
  abortWorkflowSchema,
  pauseWorkflowSchema,
];

export function buildActionsPromptSection(): string {
  return allCaptainActionSchemas
    .map((s, i) => {
      if (s.promptExample) {
        return `${i + 1}. ${s.name} — ${s.description}\n   ${s.promptExample}`;
      }
      const shape = (s.schema as z.ZodObject<any>).shape || {};
      const params = [
        `"type": "${s.name}"`,
        ...Object.entries(shape).map(([k, v]) => {
          const desc = (v as z.ZodTypeAny).description || k;
          return `"${k}": <${desc}>`;
        }),
      ];
      return `${i + 1}. ${s.name} — ${s.description}\n   {${params.join(', ')}}`;
    })
    .join('\n\n');
}
