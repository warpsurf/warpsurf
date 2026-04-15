import { z } from 'zod';
import { allCaptainActionSchemas } from '../captain-actions/schemas';

// Build one top-level Zod schema that mirrors the captain-decision shape
// parseDecision consumes: { status_message, actions: [{type, ...args}] }.
// Each action variant is derived from its existing per-action schema in
// captain-actions/schemas.ts by prepending a `type: z.literal(<name>)`
// discriminator. Used with llm.withStructuredOutput so the model API
// enforces conformance server-side instead of the extension parsing prose.
const actionVariants = allCaptainActionSchemas.map(actionSchema =>
  z.object({
    type: z.literal(actionSchema.name).describe(actionSchema.description),
    ...(actionSchema.schema as z.ZodObject<any>).shape,
  }),
) as z.ZodObject<any>[];

// z.union requires a two-or-more tuple at the type level but accepts arrays
// at runtime; the cast keeps TS happy without losing safety because
// allCaptainActionSchemas is guaranteed non-empty at module load.
export const captainActionSchema = z.union(
  actionVariants as unknown as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]],
);

export const captainDecisionSchema = z.object({
  status_message: z.string().describe('Short human-readable summary of what you are doing and why'),
  actions: z
    .array(captainActionSchema)
    .describe('List of actions to execute this tick. Use an empty array if no intervention is needed.'),
});

export type CaptainDecisionOutput = z.infer<typeof captainDecisionSchema>;
