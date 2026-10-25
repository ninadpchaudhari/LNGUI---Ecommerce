/**
 * An experiment file (experiments/*.json): which frozen test set, which
 * conditions, how many trials. The Experiments page writes these and
 * scripts/sweep.ts reads them, so both validate with this one schema.
 */
import { z } from "zod";
import { checkOverrides } from "./overrides.ts";
import { fixedSampling } from "./models.ts";

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
    id: z.string().regex(/^[\w.-]+$/, "configuration ids use letters, digits, dot, dash and underscore"),
    prompt: promptRefSchema,
    env: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((c, ctx) => {
    if ("SYSTEM_PROMPT" in c.env) {
      ctx.addIssue({ code: "custom", message: `${c.id}: put the prompt in "prompt", not in env` });
    }
    const sampled = Boolean(c.env.LLM_TEMPERATURE?.trim() || c.env.LLM_TOP_P?.trim());
    if (c.env.LOCAL_TEST_MODE === "true") {
      // The local parser does not sample.
    } else if (fixedSampling(c.env.LLM_PROVIDER, c.env.LLM_MODEL)) {
      // Takes neither; any given are dropped with a warning when the conditions load.
    } else if (!sampled) {
      // Unset, the provider's own default applies, and providers differ (Ollama 0.8, OpenAI 1).
      ctx.addIssue({ code: "custom", message: `${c.id}: set LLM_TEMPERATURE or LLM_TOP_P, so the sampling is stated rather than left to the provider` });
    }
    for (const [key, max] of [["LLM_TEMPERATURE", 2], ["LLM_TOP_P", 1]] as const) {
      const v = c.env[key]?.trim();
      if (v && !(Number(v) >= 0 && Number(v) <= max)) ctx.addIssue({ code: "custom", message: `${c.id}: ${key} must be a number from 0 to ${max}` });
    }
    for (const p of checkOverrides(c.env).problems) ctx.addIssue({ code: "custom", message: `${c.id}: ${p}` });
  });

/**
 * What a condition sends, apart from the prompt text: its env with the history
 * default stated (as the Experiments page states it) and, for a model that
 * takes no temperature or top_p, those removed. The page and the CLI both run
 * conditions through this, so one file sends the same thing from either.
 */
export function effectiveEnv(env: Readonly<Record<string, string>>): { env: Record<string, string>; dropped: string[] } {
  const out: Record<string, string> = { HISTORY_POLICY: "full", ...env };
  const dropped: string[] = [];
  if (out.LOCAL_TEST_MODE !== "true" && fixedSampling(out.LLM_PROVIDER, out.LLM_MODEL)) {
    for (const k of ["LLM_TEMPERATURE", "LLM_TOP_P"] as const) {
      if (k in out) {
        dropped.push(k);
        delete out[k];
      }
    }
  }
  return { env: out, dropped };
}

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
    if (dupes.length > 0) ctx.addIssue({ code: "custom", message: `duplicate configuration ids: ${dupes.join(", ")}` });
    // Two conditions that send the same thing are the same run, paid for twice.
    const seen = new Map<string, string>();
    for (const c of e.conditions) {
      const { env } = effectiveEnv(c.env);
      delete env.LNGUI_COMMAND_MODE; // set by the prompt's header
      const key = JSON.stringify([c.prompt.sha256, Object.entries(env).sort(([a], [b]) => a.localeCompare(b))]);
      const twin = seen.get(key);
      if (twin) ctx.addIssue({ code: "custom", message: `configurations ${twin} and ${c.id} are the same run; change or remove one` });
      else seen.set(key, c.id);
    }
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
