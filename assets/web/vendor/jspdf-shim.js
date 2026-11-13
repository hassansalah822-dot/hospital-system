/*
 * Offline PDF builder for Merowe HIS.
 *
 * Provides the small part of the jsPDF API the app uses (window.jspdf.jsPDF), built on
 * pdf-lib, which is bundled in this folder. Nothing is downloaded, so PDFs work offline.
 *
 * Coordinates are millimetres from the top-left corner (same as jsPDF).
 * Output is asynchronous: call  await doc.output('blob')  to get the PDF file.
 */
(function (root) {
    'use strict';

    const PT = 72 / 25.4;            // points per millimetre
    const PAGE_W = 210, PAGE_H = 297; // A4 in mm

    // Characters that the standard PDF fonts can draw (WinAnsi), beyond plain ASCII/Latin-1.
    const KEEP = new Set(['•', '–', '—', '‘', '’', '“', '”',
        '…', '€', '™']);

    // Replace anything the standard fonts cannot draw (for example Arabic text) with '?'.
    function clean(str) {
        let out = '';
        for (const ch of String(str === undefined || str === null ? '' : str)) {
            const c = ch.codePointAt(0);
            if (c === 9 || c === 10 || c === 13) out += ' ';
            else if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || KEEP.has(ch)) out += ch;
            else out += '?';
        }
        return out;
    }

    // Standard-font metrics, measured once at load so text can be wrapped synchronously.
    const measure = {};
    const ready = (async () => {
        const L = root.PDFLib;
        const d = await L.PDFDocument.create();
        measure.normal = await d.embedFont(L.StandardFonts.Helvetica);
        measure.bold = await d.embedFont(L.StandardFonts.HelveticaBold);
    })().catch((e) => console.warn('PDF metrics not ready', e));

    function textWidthMm(str, style, size) {
        const s = clean(str);
        const f = measure[style];
        const pt = f ? f.widthOfTextAtSize(s, size) : s.length * size * 0.5;
        return pt / PT;
    }

    // Decode a data: URL into bytes.
    function dataBytes(src) {
        const i = String(src).indexOf(',');
        const bin = atob(String(src).slice(i + 1));
        const u = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j);
        return u;
    }

    function imageSize(bytes) {
        // PNG: width/height in the IHDR chunk
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            return { width: dv.getUint32(16), height: dv.getUint32(20) };
        }
        // JPEG: width/height in the SOF marker
        for (let i = 2; i < bytes.length - 9; i++) {
            if (bytes[i] === 0xFF && bytes[i + 1] >= 0xC0 && bytes[i + 1] <= 0xC2) {
                return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
            }
        }
        return { width: 1, height: 1 };
    }

    class PDFShim {
        constructor() {
            this.pages = [[]];
            this.cur = 0;
            this.images = [];            // { src, type }
            this.imageIndex = new Map(); // src -> index in images
            this.st = { font: 'normal', size: 10, text: [0, 0, 0], fill: [0, 0, 0], draw: [0, 0, 0], lw: 0.2 };
            const self = this;
            this.internal = {
                pageSize: { getWidth: () => PAGE_W, getHeight: () => PAGE_H },
                getNumberOfPages: () => self.pages.length
            };
        }

        setFont(_family, style) { this.st.font = /bold/i.test(style || '') ? 'bold' : 'normal'; return this; }
        setFontSize(n) { this.st.size = Number(n) || 10; return this; }
        setTextColor(r, g, b) { this.st.text = [r, g, b]; return this; }
        setFillColor(r, g, b) { this.st.fill = [r, g, b]; return this; }
        setDrawColor(r, g, b) { this.st.draw = [r, g, b]; return this; }
        setLineWidth(mm) { this.st.lw = mm; return this; }

        addPage() { this.pages.push([]); this.cur = this.pages.length - 1; return this; }
        setPage(n) { this.cur = Math.max(0, Math.min(this.pages.length - 1, n - 1)); return this; }

        getTextWidth(str) { return textWidthMm(str, this.st.font, this.st.size); }

        splitTextToSize(str, maxMm) {
            const font = this.st.font, size = this.st.size;
            const w = (s) => textWidthMm(s, font, size);
            const out = [];
            for (const para of clean(str).split('\n')) {
                let line = '';
                for (const word of para.split(' ')) {
                    const cand = line ? line + ' ' + word : word;
                    if (!line || w(cand) <= maxMm) line = cand;
                    else { out.push(line); line = word; }
                    // A single word wider than the line is broken up character by character.
                    while (w(line) > maxMm && line.length > 1) {
                        let cut = line.length - 1;
                        while (cut > 1 && w(line.slice(0, cut)) > maxMm) cut--;
                        out.push(line.slice(0, cut));
                        line = line.slice(cut);
                    }
                }
                out.push(line);
            }
            return out;
        }

        text(str, x, y, opts) {
            const s = clean(str);
            let xx = x;
            if (opts && opts.align === 'right') xx = x - textWidthMm(s, this.st.font, this.st.size);
            this.pages[this.cur].push({ k: 'text', s, x: xx, y, font: this.st.font, size: this.st.size, color: this.st.text.slice() });
            return this;
        }

        rect(x, y, w, h, style) { return this._rect(x, y, w, h, style); }
        // Corners are drawn square (the rounded corners are a cosmetic difference only).
        roundedRect(x, y, w, h, _rx, _ry, style) { return this._rect(x, y, w, h, style); }

        _rect(x, y, w, h, style) {
            const s = String(style || 'S');
            this.pages[this.cur].push({
                k: 'rect', x, y, w, h,
                fill: /F/.test(s) ? this.st.fill.slice() : null,
                stroke: /[DS]/.test(s) ? this.st.draw.slice() : null,
                lw: this.st.lw
            });
            return this;
        }

        line(x1, y1, x2, y2) {
            this.pages[this.cur].push({ k: 'line', x1, y1, x2, y2, color: this.st.draw.slice(), lw: this.st.lw });
            return this;
        }

        getImageProperties(src) {
            const size = imageSize(dataBytes(src));
            return { width: size.width, height: size.height };
        }

        addImage(src, format, x, y, w, h) {
            let idx = this.imageIndex.get(src);
            if (idx === undefined) {
                idx = this.images.length;
                this.images.push({ src, type: /jpe?g/i.test(format || '') || /^data:image\/jpe?g/i.test(src) ? 'JPEG' : 'PNG' });
                this.imageIndex.set(src, idx);
            }
            this.pages[this.cur].push({ k: 'img', idx, x, y, w, h });
            return this;
        }

        // Builds the PDF. Resolves to a Blob (type 'blob', default) or to the raw bytes.
        async output(type) {
            await ready;
            const L = root.PDFLib;
            const doc = await L.PDFDocument.create();
            const fonts = {
                normal: await doc.embedFont(L.StandardFonts.Helvetica),
                bold: await doc.embedFont(L.StandardFonts.HelveticaBold)
            };
            const embedded = [];
            for (const im of this.images) {
                const bytes = dataBytes(im.src);
                embedded.push(im.type === 'JPEG' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes));
            }
            const rgb = (c) => L.rgb(c[0] / 255, c[1] / 255, c[2] / 255);
            const W = PAGE_W * PT, H = PAGE_H * PT;

            for (const ops of this.pages) {
                const page = doc.addPage([W, H]);
                for (const op of ops) {
                    if (op.k === 'text') {
                        if (!op.s) continue;
                        page.drawText(op.s, {
                            x: op.x * PT, y: H - op.y * PT, size: op.size,
                            font: fonts[op.font], color: rgb(op.color)
                        });
                    } else if (op.k === 'rect') {
                        if (op.w <= 0 || op.h <= 0) continue;
                        const opts = {
                            x: op.x * PT, y: H - (op.y + op.h) * PT,
                            width: op.w * PT, height: op.h * PT
                        };
                        if (op.fill) opts.color = rgb(op.fill);
                        if (op.stroke) { opts.borderColor = rgb(op.stroke); opts.borderWidth = op.lw * PT; }
                        else opts.borderWidth = 0;
                        page.drawRectangle(opts);
                    } else if (op.k === 'line') {
                        page.drawLine({
                            start: { x: op.x1 * PT, y: H - op.y1 * PT },
                            end: { x: op.x2 * PT, y: H - op.y2 * PT },
                            thickness: op.lw * PT, color: rgb(op.color)
                        });
                    } else if (op.k === 'img') {
                        page.drawImage(embedded[op.idx], {
                            x: op.x * PT, y: H - (op.y + op.h) * PT,
                            width: op.w * PT, height: op.h * PT
                        });
                    }
                }
            }

            const bytes = await doc.save();
            if (type === 'blob' || type === undefined) return new Blob([bytes], { type: 'application/pdf' });
            return bytes;
        }
    }

    root.jspdf = { jsPDF: PDFShim };
    root.__jsPDFShimReady = ready;
})(typeof window !== 'undefined' ? window : globalThis);
