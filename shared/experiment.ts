/**
 * An experiment file (experiments/*.json): which frozen test set, which
 * conditions, how many trials. The Experiments page writes these and
 * scripts/sweep.ts reads them, so both validate with this one schema.
 */
import { z } from "zod";
import { checkOverrides } from "./overrides.ts";

/**
 * The system prompt of a condition: a text file in the repo and the SHA-256 of
 * its normalized text (shared/prompt-text.ts). The prompt is part of the
 * experiment, so every condition names one. There is no default and no named
 * variant.
 */
const promptRefSchema = z.object({
  file: z.string().regex(/^prompts\/[\w.-]+\.txt$/, "prompt files live in prompts/ and end in .txt"),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 is 64 hex characters"),
});

const conditionSchema = z
  .object({
    id: z.string().regex(/^[\w.-]+$/, "condition ids use letters, digits, dot, dash and underscore"),
    prompt: promptRefSchema,
    env: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((c, ctx) => {
    if ("SYSTEM_PROMPT" in c.env) {
      ctx.addIssue({ code: "custom", message: `${c.id}: put the prompt in "prompt", not in env` });
    }
    for (const p of checkOverrides(c.env).problems) ctx.addIssue({ code: "custom", message: `${c.id}: ${p}` });
  });

export const experimentSchema = z
  .object({
    name: z.string().regex(/^[\w.-]+$/, "names use letters, digits, dot, dash and underscore"),
    cases: z.string().min(1),
    /**
     * SHA-256 of the cases file this experiment was designed for. The sweep
     * refuses to start when the file on disk has a different hash.
     */
    casesSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    n: z.number().int().positive(),
    seed: z.number().int().default(1),
    concurrency: z.number().int().positive().default(4),
    maxInfraRetries: z.number().int().min(0).default(2),
    conditions: z.array(conditionSchema).min(1),
  })
  .superRefine((e, ctx) => {
    const ids = e.conditions.map((c) => c.id);
    const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    if (dupes.length > 0) ctx.addIssue({ code: "custom", message: `duplicate condition ids: ${dupes.join(", ")}` });
  });

export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentCondition = Experiment["conditions"][number];

/**
 * Written next to a cases file as `<name>.manifest.json`, so anyone can
 * regenerate the test set and check its hash.
 */
export interface CasesManifest {
  file: string;
  sha256: string;
  caseCount: number;
  generator: { seed: number; groups: number; perGroup: number; amnesia: boolean } | null;
  git: { commit: string | null; dirty: boolean } | null;
  createdAt: string;
  /** Cases per report row. */
  counts: Record<string, number>;
}
