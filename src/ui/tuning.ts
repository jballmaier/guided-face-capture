import type { PositionSpec } from "../protocol/positions";
import { TUNING_LIMITS, type PositionTuning, type TuningKey } from "../protocol/tuning";
import { positionLabel } from "../protocol/positions";
import { t } from "../i18n";

/** Threshold controls. Rendering only; main.ts decides what an input does. */

export interface TuningRow {
  spec: PositionSpec;
  values: PositionTuning;
  base: PositionTuning;
  changed: boolean;
  isCurrent: boolean;
}

export interface TuningHandlers {
  onChange(spec: PositionSpec, key: TuningKey, value: number): void;
  onReset(spec: PositionSpec): void;
}

const FIELD_KEY: Record<TuningKey, "tuning.minDrive" | "tuning.maxSuppress" | "tuning.holdMs"> = {
  minDrive: "tuning.minDrive",
  maxSuppress: "tuning.maxSuppress",
  holdMs: "tuning.holdMs",
};

function field(row: TuningRow, key: TuningKey, handlers: TuningHandlers): HTMLElement {
  const limits = TUNING_LIMITS[key];
  const wrap = document.createElement("label");
  wrap.className = "tunefield";

  const name = document.createElement("span");
  name.textContent = t(FIELD_KEY[key]);

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(limits.min);
  input.max = String(limits.max);
  input.step = String(limits.step);
  input.value = String(row.values[key]);
  input.inputMode = "decimal";
  // The value from the code as a tooltip: when calibrating you want to know
  // what you are moving away from.
  input.title = t("tuning.default", { value: row.base[key] });
  input.classList.toggle("is-changed", row.values[key] !== row.base[key]);
  input.addEventListener("change", () => {
    const value = Number.parseFloat(input.value);
    handlers.onChange(row.spec, key, value);
  });

  wrap.append(name, input);
  return wrap;
}

export function renderTuning(
  target: HTMLElement,
  rows: readonly TuningRow[],
  handlers: TuningHandlers,
): void {
  target.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("li");
      item.classList.toggle("is-current", row.isCurrent);
      item.classList.toggle("is-changed", row.changed);

      const head = document.createElement("div");
      head.className = "tunehead";

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(row.spec.index);

      const label = document.createElement("span");
      label.className = "tunename";
      label.textContent = positionLabel(row.spec);

      head.append(num, label);

      if (row.changed) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "tunereset";
        reset.textContent = t("tuning.reset");
        reset.title = t("tuning.reset.title");
        reset.addEventListener("click", () => handlers.onReset(row.spec));
        head.append(reset);
      }

      const fields = document.createElement("div");
      fields.className = "tunefields";
      fields.append(
        field(row, "minDrive", handlers),
        field(row, "maxSuppress", handlers),
        field(row, "holdMs", handlers),
      );

      item.append(head, fields);
      return item;
    }),
  );
}
