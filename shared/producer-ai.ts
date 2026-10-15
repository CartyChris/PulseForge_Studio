/**
 * Contracts for the AI side of the end-to-end producer. Shared by the server (validates model
 * output before it leaves the backend) and the app (validates again before touching a project).
 */
import { z } from "zod";
import { ProductionSpecSchema } from "./producer";
import { DawCommandSchema, EditPlanSchema } from "./commands";

/** revise: either regenerate from a revised spec (creative/structural change) or apply precise edits */
export const ProduceReviseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("respec"), spec: ProductionSpecSchema, explanation: z.string().max(1200).default("") }),
  z.object({ action: z.literal("edit"), plan: EditPlanSchema }),
]);
export type ProduceRevise = z.infer<typeof ProduceReviseSchema>;

/** critique: the model listens "through the numbers" and proposes conservative mix fixes */
export const ProduceCritiqueSchema = z.object({
  verdict: z.enum(["ship", "revise"]).default("ship"),
  summary: z.string().max(1500).default(""),
  issues: z.array(z.string().max(300)).max(12).default([]),
  commands: z.array(DawCommandSchema).max(40).default([]),
});
export type ProduceCritique = z.infer<typeof ProduceCritiqueSchema>;

function first(err: z.ZodError, label: string): Error {
  const i = err.issues[0];
  return new Error(`Invalid ${label}: ${i?.path.join(".")}: ${i?.message}`);
}
export function validateProduceRevise(raw: unknown): ProduceRevise {
  const r = ProduceReviseSchema.safeParse(raw);
  if (!r.success) throw first(r.error, "revision");
  return r.data;
}
export function validateProduceCritique(raw: unknown): ProduceCritique {
  const r = ProduceCritiqueSchema.safeParse(raw);
  if (!r.success) throw first(r.error, "critique");
  return r.data;
}
