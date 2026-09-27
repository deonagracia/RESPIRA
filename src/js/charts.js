/**
 * charts.js — Phase 2
 * -----------------------------------------------------------------------
 * A small, dependency-free canvas line-chart utility. Chosen over a
 * charting library to keep the stack "sederhana" (per the project brief)
 * — this only needs to draw a handful of rolling or static time-series
 * lines with the RESPIRA color palette, which does not warrant a new
 * dependency.
 *
 * Two usage modes:
 *  - Rolling (Simulation page): construct with `windowSec`, call push()
 *    on every tick; old points outside the time window are dropped.
 *  - Static (Analysis page): construct without `windowSec`, call
 *    setData() once with a full recorded array.
 */

export class LineChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   * @param {Array<{key:string, color:string, label?:string, dashed?:boolean, fill?:boolean, width?:number}>} options.series
   * @param {number} [options.windowSec] - rolling mode window, in seconds (x = point.t)
   * @param {number} [options.maxPoints=800] - cap for static/non-windowed mode
   * @param {number} [options.yMin] - fixed y-axis minimum (omit to auto-scale)
   * @param {number} [options.yMax] - fixed y-axis maximum (omit to auto-scale)
   * @param {string} [options.unit=''] - unit suffix for the live value labels
   */
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = options.series;
    this.windowSec = options.windowSec ?? null;
    this.maxPoints = options.maxPoints ?? 800;
    this.yMin = options.yMin ?? null;
    this.yMax = options.yMax ?? null;
    this.yPad = options.yPad ?? 0.18;
    this.unit = options.unit ?? '';
    this.data = [];

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas);
    this._resize();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height || this.canvas.height || 120));

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._cssW = width;
    this._cssH = height;
    this._render();
  }

  /**
   * Append one data point (rolling mode) or a fixed-buffer sample.
   * @param {{t:number, [seriesKey:string]:number}} point
   */
  push(point) {
    this.data.push(point);

    if (this.windowSec != null) {
      const cutoff = point.t - this.windowSec;
      while (this.data.length > 1 && this.data[0].t < cutoff) this.data.shift();
    } else if (this.data.length > this.maxPoints) {
      this.data.splice(0, this.data.length - this.maxPoints);
    }

    this._render();
  }

  /** Replace the entire buffer at once (static mode). */
  setData(points) {
    this.data = points.slice();
    this._render();
  }

  clear() {
    this.data = [];
    this._render();
  }

  destroy() {
    this._resizeObserver.disconnect();
  }

  _render() {
    const ctx = this.ctx;
    const w = this._cssW;
    const h = this._cssH;
    ctx.clearRect(0, 0, w, h);

    if (!this.data.length) return;

    const xs = this.data.map((d) => d.t);
    const xMin = xs[0];
    const xMax = xs[xs.length - 1] > xMin ? xs[xs.length - 1] : xMin + 1;

    let yMin = this.yMin;
    let yMax = this.yMax;
    if (yMin == null || yMax == null) {
      let lo = Infinity;
      let hi = -Infinity;
      this.series.forEach((s) => {
        this.data.forEach((d) => {
          const v = d[s.key];
          if (v == null || Number.isNaN(v)) return;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        });
      });
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      if (lo === hi) {
        lo -= 1;
        hi += 1;
      }
      const pad = (hi - lo) * this.yPad;
      yMin = this.yMin ?? lo - pad;
      yMax = this.yMax ?? hi + pad;
    }
    if (yMax <= yMin) yMax = yMin + 1;

    const xToPx = (x) => ((x - xMin) / (xMax - xMin)) * w;
    const yToPx = (y) => h - ((y - yMin) / (yMax - yMin)) * h;

    // Gridlines
    ctx.strokeStyle = 'rgba(125, 211, 208, 0.12)';
    ctx.lineWidth = 1;
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const y = Math.round((h / rows) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Zero line, when zero is within the visible range (helps read flow/error charts)
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(125, 211, 208, 0.3)';
      const zy = Math.round(yToPx(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, zy);
      ctx.lineTo(w, zy);
      ctx.stroke();
    }

    this.series.forEach((s) => {
      const points = [];
      this.data.forEach((d) => {
        const v = d[s.key];
        if (v == null || Number.isNaN(v)) return;
        points.push([xToPx(d.t), yToPx(v)]);
      });
      if (points.length < 2) return;

      if (s.fill) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], h);
        points.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.lineTo(points[points.length - 1][0], h);
        ctx.closePath();
        ctx.fillStyle = s.fillColor ?? withAlpha(s.color, 0.14);
        ctx.fill();
      }

      ctx.beginPath();
      points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.dashed ? [6, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Live value readout, top-right, one line per series
    const last = this.data[this.data.length - 1];
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'hanging';
    let ly = 6;
    this.series.forEach((s) => {
      const v = last[s.key];
      if (v == null || Number.isNaN(v)) return;
      ctx.fillStyle = s.color;
      const label = s.label ? `${s.label} ` : '';
      ctx.fillText(`${label}${v.toFixed(1)}${this.unit}`, w - 6, ly);
      ly += 13;
    });
  }
}

function withAlpha(hexColor, alpha) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default LineChart;
