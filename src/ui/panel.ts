import type { Blendshapes } from "../types";
import { t } from "../i18n";

/** Panel building blocks. Rendering only; main.ts decides what is shown. */

export interface ReadoutRow {
  term: string;
  value: string;
  state?: "ok" | "bad";
}

export function renderReadout(target: HTMLElement, rows: readonly ReadoutRow[]): void {
  const cells: HTMLElement[] = [];
  for (const row of rows) {
    const dt = document.createElement("dt");
    dt.textContent = row.term;
    const dd = document.createElement("dd");
    dd.textContent = row.value;
    if (row.state) dd.className = row.state;
    cells.push(dt, dd);
  }
  target.replaceChildren(...cells);
}

export function renderBars(target: HTMLElement, blendshapes: Blendshapes | null, count: number): void {
  if (!blendshapes) {
    target.replaceChildren();
    return;
  }
  const top = Object.entries(blendshapes)
    .filter(([name]) => name !== "_neutral")
    .sort((a, b) => b[1] - a[1])
    .slice(0, count);

  target.replaceChildren(
    ...top.map(([name, score]) => {
      const row = document.createElement("div");
      row.className = "barrow";

      const label = document.createElement("span");
      label.textContent = name;

      const track = document.createElement("div");
      track.className = "bartrack";
      const fill = document.createElement("div");
      fill.className = "barfill";
      fill.style.width = `${Math.round(score * 100)}%`;
      track.append(fill);

      const value = document.createElement("span");
      value.textContent = score.toFixed(2);

      row.append(label, track, value);
      return row;
    }),
  );
}

export interface SideEntry {
  label: string;
  left: number;
  right: number;
  /** Geometric measure rather than blendshape - scaled differently. */
  scale?: number;
}

/**
 * Side comparison.
 *
 * The trigger takes only the stronger side, so the sequence can be completed
 * one-sidedly. The difference between the sides is what gets analysed, so it
 * belongs on screen during the session.
 */
export function renderSideCompare(target: HTMLElement, entries: readonly SideEntry[]): void {
  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "muted small";
    hint.textContent = t("debug.noSideMeasure");
    target.replaceChildren(hint);
    return;
  }

  target.replaceChildren(
    ...entries.map((entry) => {
      const scale = entry.scale ?? 1;
      const leftPct = clampPct((entry.left / scale) * 100);
      const rightPct = clampPct((entry.right / scale) * 100);
      const delta = Math.abs(entry.left - entry.right);

      const box = document.createElement("div");
      box.className = "cmp";

      const label = document.createElement("div");
      label.className = "cmp-label";
      label.append(document.createTextNode(entry.label));
      const deltaEl = document.createElement("span");
      deltaEl.className = "cmp-delta";
      deltaEl.textContent = `Δ ${delta.toFixed(2)}`;
      label.append(deltaEl);

      const track = document.createElement("div");
      track.className = "cmp-track";
      track.append(half("left", leftPct), half("right", rightPct));

      const values = document.createElement("div");
      values.className = "cmp-values";
      const l = document.createElement("span");
      l.textContent = entry.left.toFixed(2);
      const r = document.createElement("span");
      r.textContent = entry.right.toFixed(2);
      values.append(l, r);

      box.append(label, track, values);
      return box;
    }),
  );
}

function half(side: "left" | "right", pct: number): HTMLElement {
  const el = document.createElement("div");
  el.className = `cmp-half ${side}`;
  const fill = document.createElement("div");
  fill.className = "cmp-fill";
  fill.style.width = `${pct}%`;
  el.append(fill);
  return el;
}

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}
