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
    this.yLabel = options.yLabel ?? ''; // judul sumbu Y (dengan satuan)
    this.xLabel = options.xLabel ?? 'Waktu (s)';
    this.refLines = options.refLines ?? []; // [{y, label, color}] garis referensi horizontal
    this.showAxes = options.showAxes ?? true;
    this.decimals = options.decimals ?? 1;
    // 'dark' (halaman Simulate) atau 'light' (halaman Analyze)
    const light = options.theme === 'light';
    this.axisText = light ? 'rgba(16, 42, 67, 0.8)' : 'rgba(200, 230, 228, 0.8)';
    this.axisLine = light ? 'rgba(16, 42, 67, 0.45)' : 'rgba(200, 230, 228, 0.45)';
    this.gridLine = light ? 'rgba(16, 42, 67, 0.08)' : 'rgba(125, 211, 208, 0.12)';
    this.data = [];
    this.bands = []; // [{start, end, type:'apnea'|'hypopnea'}] — area kejadian OSA

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

  /**
   * Tandai interval kejadian OSA (gaya rekaman polisomnografi).
   * @param {Array<{start:number, end:number, type:string}>} bands
   */
  setBands(bands) {
    this.bands = Array.isArray(bands) ? bands : [];
    this._render();
  }

  clear() {
    this.data = [];
    this.bands = [];
    this._render();
  }

  destroy() {
    this._resizeObserver.disconnect();
  }

  _render() {
    const ctx = this.ctx;
    const W = this._cssW;
    const H = this._cssH;
    ctx.clearRect(0, 0, W, H);

    // Margin untuk sumbu (standar grafik: sumbu X = waktu, sumbu Y = besaran + satuan)
    const ml = this.showAxes ? 42 : 0;
    const mb = this.showAxes ? 22 : 0;
    const mt = 6;
    const mr = 6;
    const w = Math.max(1, W - ml - mr);
    const h = Math.max(1, H - mt - mb);

    if (!this.data.length) return;

    const xs = this.data.map((d) => d.t);
    let xMax = xs[xs.length - 1];
    let xMin = this.windowSec != null ? Math.max(0, xMax - this.windowSec) : xs[0];
    if (this.windowSec != null && xMax < this.windowSec) {
      xMin = 0;
      xMax = this.windowSec; // jendela tetap: grafik mengalir dari kiri ke kanan
    }
    if (xMax <= xMin) xMax = xMin + 1;

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

    const xToPx = (x) => ml + ((x - xMin) / (xMax - xMin)) * w;
    const yToPx = (y) => mt + h - ((y - yMin) / (yMax - yMin)) * h;

    // Gridlines + label tick sumbu Y
    ctx.font = '10px Inter, sans-serif';
    const yStep = niceStep((yMax - yMin) / 4);
    ctx.strokeStyle = this.gridLine;
    ctx.lineWidth = 1;
    ctx.fillStyle = this.axisText;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax + 1e-9; v += yStep) {
      const y = Math.round(yToPx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(ml, y);
      ctx.lineTo(ml + w, y);
      ctx.stroke();
      if (this.showAxes) ctx.fillText(formatTick(v, yStep), ml - 4, y);
    }

    // Tick sumbu X (waktu)
    if (this.showAxes) {
      const xStep = niceStep((xMax - xMin) / 5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let v = Math.ceil(xMin / xStep) * xStep; v <= xMax + 1e-9; v += xStep) {
        const x = Math.round(xToPx(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, mt);
        ctx.lineTo(x, mt + h);
        ctx.stroke();
        ctx.fillText(formatTick(v, xStep), x, mt + h + 3);
      }
      // Garis sumbu
      ctx.strokeStyle = this.axisLine;
      ctx.beginPath();
      ctx.moveTo(ml + 0.5, mt);
      ctx.lineTo(ml + 0.5, mt + h);
      ctx.lineTo(ml + w, mt + h);
      ctx.stroke();
      // Judul sumbu
      ctx.fillStyle = this.axisText;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.xLabel, ml + w, H);
      if (this.yLabel) {
        ctx.save();
        ctx.translate(9, mt + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.yLabel, 0, 0);
        ctx.restore();
      }
    }

    // Garis nol (penting untuk grafik aliran: + inspirasi, − ekspirasi)
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(125, 211, 208, 0.45)';
      const zy = Math.round(yToPx(0)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(ml, zy);
      ctx.lineTo(ml + w, zy);
      ctx.stroke();
    }

    // Garis referensi (mis. RV, FRC, TLC pada grafik volume)
    this.refLines.forEach((r) => {
      if (r.y < yMin || r.y > yMax) return;
      const y = Math.round(yToPx(r.y)) + 0.5;
      ctx.strokeStyle = r.color ?? 'rgba(244, 185, 66, 0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ml, y);
      ctx.lineTo(ml + w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = r.color ?? 'rgba(244, 185, 66, 0.85)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(r.label, ml + 4, y - 1);
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, w, h);
    ctx.clip();

    // Area kejadian apnea (merah) / hipopnea (kuning)
    this.bands.forEach((b) => {
      if (b.end < xMin || b.start > xMax) return;
      const x0 = xToPx(Math.max(xMin, b.start));
      const x1 = xToPx(Math.min(xMax, b.end));
      const apnea = b.type === 'apnea';
      ctx.fillStyle = apnea ? 'rgba(217, 74, 74, 0.16)' : 'rgba(244, 185, 66, 0.16)';
      ctx.fillRect(x0, mt, Math.max(1, x1 - x0), h);
      ctx.fillStyle = apnea ? 'rgba(217, 74, 74, 0.95)' : 'rgba(244, 185, 66, 0.95)';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      if (x1 - x0 > 14) ctx.fillText(apnea ? 'Apnea' : 'Hipopnea', x0 + 3, mt + h - 2); // label di bawah agar tidak menumpuk label TLC/nilai
    });

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
        const base = yMin < 0 && yMax > 0 ? yToPx(0) : mt + h;
        ctx.moveTo(points[0][0], base);
        points.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.lineTo(points[points.length - 1][0], base);
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
    ctx.restore();

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
      ctx.fillText(`${label}${v.toFixed(this.decimals ?? 1)}${this.unit}`, W - 6, ly);
      ly += 13;
    });
  }
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}

function formatTick(v, step) {
  const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  const r = Math.abs(v) < step * 1e-6 ? 0 : v;
  return r.toFixed(d);
}

function withAlpha(hexColor, alpha) {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default LineChart;
