import { useState } from "react";
import type { AppConfig } from "../utils/types.ts";

interface Props {
  config: AppConfig | null;
  model: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

const OTHER = "__other__";

/**
 * Model selection for one request. The default arrives from /api/config, which
 * reads it from the environment — so a sweep repeats without touching the UI,
 * and §5.7's "hold P fixed" is the default rather than a discipline.
 */
export function ModelPicker({ config, model, onChange, disabled }: Props) {
  const models = config?.models ?? [];
  const allowAny = config?.allowAnyModel ?? false;
  const [freeText, setFreeText] = useState(false);

  const known = models.includes(model);
  const showFreeText = allowAny && (freeText || !known);

  return (
    <div className="model-picker">
      <label className="model-picker-label">
        model
        <select
          value={showFreeText ? OTHER : model}
          disabled={disabled || models.length === 0}
          onChange={(e) => {
            if (e.target.value === OTHER) {
              setFreeText(true);
              return;
            }
            setFreeText(false);
            onChange(e.target.value);
          }}
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
              {m === config?.defaultModel ? "  (env default)" : ""}
            </option>
          ))}
          {allowAny && <option value={OTHER}>other…</option>}
        </select>
      </label>

      {showFreeText && (
        <input
          className="model-picker-input"
          type="text"
          value={model}
          placeholder="provider/model-id"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
