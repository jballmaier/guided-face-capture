/**
 * Live strip chart for the drive curves.
 *
 * A number jumping thirty times a second does not show whether a movement was
 * held too briefly, the threshold sits too high, or the signal collapses
 * between frames. The trace does.
 */

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export interface StripChartOptions {
  /** Visible span in milliseconds. */
  windowMs?: number;
  series: SeriesSpec[];
}

interface Point {
  t: number;
  v: number;
}

export class StripChart {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly data = new Map<string, Point[]>();
  private readonly windowMs: number;
  private threshold: number | null = null;
  private light = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: StripChartOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D-Kontext fuer den Graphen nicht verfuegbar");
    this.ctx = ctx;
    this.windowMs = options.windowMs ?? 6000;
    for (const s of options.series) this.data.set(s.key, []);
  }

  setTheme(light: boolean): void {
    this.light = light;
  }

  setThreshold(value: number | null): void {
    this.threshold = value;
  }

  clear(): void {
    for (const points of this.data.values()) points.length = 0;
  }

  push(t: number, values: Readonly<Record<string, number>>): void {
    for (const [key, points] of this.data) {
      const v = values[key];
      if (v === undefined) continue;
      points.push({ t, v });
      const cutoff = t - this.windowMs;
      let drop = 0;
      while (drop < points.length && points[drop]!.t < cutoff) drop++;
      if (drop > 0) points.splice(0, drop);
    }
  }

  render(nowMs: number): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const grid = this.light ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.12)";
    const axisText = this.light ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.45)";

    const padLeft = 2;
    const padRight = 34;
    const plotWidth = Math.max(1, cssWidth - padLeft - padRight);
    const toX = (t: number) => padLeft + ((t - (nowMs - this.windowMs)) / this.windowMs) * plotWidth;
    const toY = (v: number) => cssHeight - v * cssHeight;

    // Grid at 0, 0.5 and 1
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const level of [0, 0.5, 1]) {
      const y = Math.round(toY(level)) + 0.5;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
    }
    ctx.stroke();

    // Trigger threshold
    if (this.threshold !== null) {
      ctx.save();
      ctx.strokeStyle = this.light ? "rgba(168,72,10,0.75)" : "rgba(240,180,41,0.75)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      const y = Math.round(toY(this.threshold)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotWidth, y);
      ctx.stroke();
      ctx.restore();
    }

    // Curves
    for (const spec of this.options.series) {
      const points = this.data.get(spec.key);
      if (!points || points.length < 2) continue;
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (const p of points) {
        const x = toX(p.t);
        const y = toY(p.v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Current value at the right edge
      const last = points[points.length - 1]!;
      ctx.fillStyle = spec.color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(last.v.toFixed(2), padLeft + plotWidth + 4, clampY(toY(last.v), cssHeight));
    }

    ctx.fillStyle = axisText;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`${(this.windowMs / 1000).toFixed(0)} s`, padLeft + 2, 2);
  }
}

function clampY(y: number, height: number): number {
  return Math.min(height - 7, Math.max(7, y));
}
