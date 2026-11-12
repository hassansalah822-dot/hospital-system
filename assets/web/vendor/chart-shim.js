/*
 * Minimal offline line chart for the vitals graph (replaces Chart.js, which needs the internet).
 * Supports: new Chart(canvas, { type: 'line', data: { labels, datasets: [{ label, data, borderColor }] } })
 * and chart.destroy(). Tooltips are not included.
 */
(function (root) {
    'use strict';

    class Chart {
        constructor(canvas, config) {
            this.canvas = canvas;
            this.config = config || {};
            this._resize = () => this.draw();
            root.addEventListener('resize', this._resize);
            this.draw();
        }

        destroy() {
            root.removeEventListener('resize', this._resize);
            const ctx = this.canvas.getContext('2d');
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        draw() {
            const cv = this.canvas;
            const parent = cv.parentElement;
            const cssW = Math.max(240, (parent && parent.clientWidth) || cv.clientWidth || 320);
            const cssH = Math.max(180, (parent && parent.clientHeight) || 240);
            const dpr = root.devicePixelRatio || 1;
            cv.style.width = cssW + 'px';
            cv.style.height = cssH + 'px';
            cv.width = Math.round(cssW * dpr);
            cv.height = Math.round(cssH * dpr);
            const ctx = cv.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);

            const data = this.config.data || {};
            const labels = data.labels || [];
            const datasets = data.datasets || [];
            const n = labels.length;

            const legendH = 22, left = 38, right = 12, top = 12, bottom = 40 + legendH;
            const w = cssW - left - right, h = cssH - top - bottom;

            // y range from the data
            let min = Infinity, max = -Infinity;
            datasets.forEach((ds) => (ds.data || []).forEach((v) => {
                if (v !== null && v !== undefined && isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
            }));
            if (!isFinite(min)) { min = 0; max = 1; }
            if (min === max) { min -= 1; max += 1; }
            const pad = (max - min) * 0.08;
            min = Math.floor(min - pad); max = Math.ceil(max + pad);

            const yOf = (v) => top + h - ((v - min) / (max - min)) * h;
            const xOf = (i) => left + (n <= 1 ? w / 2 : (i * w) / (n - 1));

            // grid and y labels
            ctx.font = '11px sans-serif';
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#DDE3E0';
            ctx.fillStyle = '#6C757D';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let i = 0; i <= 4; i++) {
                const v = min + ((max - min) * i) / 4;
                const y = yOf(v);
                ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke();
                ctx.fillText(String(Math.round(v)), left - 6, y);
            }

            // x labels (thinned out when there are many)
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const step = Math.max(1, Math.ceil(n / 6));
            for (let i = 0; i < n; i += step) {
                ctx.fillText(String(labels[i]), xOf(i), top + h + 6);
            }

            // lines
            datasets.forEach((ds) => {
                const colour = ds.borderColor || '#0077B6';
                ctx.strokeStyle = colour;
                ctx.fillStyle = colour;
                ctx.lineWidth = 2;
                ctx.beginPath();
                let started = false;
                (ds.data || []).forEach((v, i) => {
                    if (v === null || v === undefined || !isFinite(v)) return;
                    const x = xOf(i), y = yOf(v);
                    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
                });
                ctx.stroke();
                (ds.data || []).forEach((v, i) => {
                    if (v === null || v === undefined || !isFinite(v)) return;
                    ctx.beginPath();
                    ctx.arc(xOf(i), yOf(v), 3, 0, Math.PI * 2);
                    ctx.fill();
                });
            });

            // legend
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            let lx = left;
            const ly = cssH - legendH / 2 - 2;
            datasets.forEach((ds) => {
                const colour = ds.borderColor || '#0077B6';
                ctx.fillStyle = colour;
                ctx.fillRect(lx, ly - 4, 10, 8);
                ctx.fillStyle = '#2B2D42';
                ctx.fillText(ds.label || '', lx + 14, ly);
                lx += 14 + ctx.measureText(ds.label || '').width + 18;
            });
        }
    }

    root.Chart = Chart;
})(typeof window !== 'undefined' ? window : globalThis);
