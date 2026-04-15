import { z } from 'zod';

// Zod schema for the Commodore's plan output. Shape matches what
// normalizePlannerJson in commodore.ts consumes. Used with
// llm.withStructuredOutput so the underlying model API enforces JSON
// conformance server-side, eliminating free-text parse failures.
export const commodoreSubtaskSchema = z.object({
  id: z.number().int().describe('Sequential subtask id starting at 1'),
  title: z.string().describe('Short human-readable title'),
  prompt: z.string().describe('Detailed instructions for the worker that will execute this subtask'),
  dependencies: z
    .array(z.number().int())
    .describe('Ids of subtasks that must complete before this one can start (empty array for root subtasks)'),
  no_browse: z
    .boolean()
    .optional()
    .describe('Set true if this subtask should be answered from internal knowledge without browsing the web'),
  suggested_urls: z
    .array(z.string())
    .optional()
    .describe('Optional list of URLs the worker should consider visiting first'),
  suggested_search_queries: z
    .array(z.string())
    .optional()
    .describe('Optional list of search queries the worker should consider running first'),
});

export const commodorePlanSchema = z.object({
  task: z.string().describe('One-sentence summary of the overall user task'),
  subtasks: z.array(commodoreSubtaskSchema).min(1).describe('The ordered list of subtasks that make up the plan'),
});

export type CommodorePlanOutput = z.infer<typeof commodorePlanSchema>;
