const docs = (function() {
    const $ = (id) => document.getElementById(id);

    // Brand palette (taken from the Merowe Medical City logo and forms)
    const C = {
        green: [0, 139, 69], greenPale: [243, 250, 246], greenLine: [191, 223, 205],
        red: [214, 40, 40], navy: [10, 25, 47], blue: [0, 110, 200],
        text: [43, 45, 66], muted: [108, 117, 125], border: [214, 222, 218], zebra: [247, 249, 248], white: [255, 255, 255]
    };
    const M = 14;               // page margin (mm)
    const CW = 182;             // content width (A4 210mm - 2 x 14mm)
    const PAGE_BOTTOM = 274;    // content must end above the footer
    const FOOTER_Y = 287;

    /* ---------- Helpers ---------- */

    function fmtDate(value, withTime) {
        const d = new Date(value);
        if (isNaN(d)) return '-';
        const p = (n) => String(n).padStart(2, '0');
        let s = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
        if (withTime) s += ` ${p(d.getHours())}:${p(d.getMinutes())}`;
        return s;
    }

    function nz(v) {
        return (v === undefined || v === null || String(v).trim() === '') ? '-' : String(v).trim();
    }

    function imgFormat(dataUrl) {
        return /^data:image\/(jpe?g)/i.test(dataUrl) ? 'JPEG' : 'PNG';
    }

    function allergyText(pat) {
        if (pat.allergyStatus === 'Allergies Present') return `Allergies present: ${pat.allergyDetails || 'not specified'}`;
        return pat.allergyStatus || 'Unknown';
    }

    function toLocalInput(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    // Lines of "a | b | c" -> rows with exactly n columns
    function parseRows(text, n) {
        return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
            const parts = line.split('|').map(s => s.trim());
            while (parts.length < n) parts.push('');
            return parts.slice(0, n);
        });
    }

    // Safe file-name fragment from the patient's name (Arabic letters are kept)
    function safeName(name) {
        return String(name || 'Patient').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 40) || 'Patient';
    }

    function getJsPDF() {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            alert('The PDF library could not be loaded. Check the internet connection and reload the page.');
            return null;
        }
        return window.jspdf.jsPDF;
    }

    /* ---------- Arabic text ----------
       Standard PDF fonts cannot draw Arabic. Arabic text is drawn with the browser's own
       text engine (which joins letters and orders them right-to-left) and placed into the
       PDF as a high-resolution image. Works on any PC that has an Arabic-capable font. */

    const PX = 48;   // canvas font size in pixels
    const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
    const isArabic = (s) => ARABIC_RE.test(String(s || ''));
    const arFont = (bold) => `${bold ? 'bold ' : ''}${PX}px Tahoma, Arial, "Segoe UI", "DejaVu Sans", sans-serif`;

    function measureArabic(text, bold) {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = arFont(bold);
        ctx.direction = 'rtl';
        return ctx.measureText(text).width;
    }

    function renderArabic(text, pt, bold, color) {
        const c = document.createElement('canvas');
        c.width = Math.ceil(measureArabic(text, bold) + 10);
        c.height = Math.ceil(PX * 1.5);
        const ctx = c.getContext('2d');
        ctx.font = arFont(bold);
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgb(${color.join(',')})`;
        ctx.fillText(text, c.width - 5, c.height / 2);
        const k = pt * 0.3528 / PX;          // mm per canvas pixel
        return { src: c.toDataURL('image/png'), w: c.width * k, h: c.height * k };
    }

    // Word-wrap an Arabic (or mixed) line to a width in mm, returning rendered images.
    function wrapArabic(str, maxMm, pt, bold, color) {
        const maxPx = maxMm / (pt * 0.3528 / PX);
        const words = String(str).trim().split(/\s+/);
        const lines = [];
        let cur = '';
        for (const w of words) {
            const cand = cur ? cur + ' ' + w : w;
            if (!cur || measureArabic(cand, bold) <= maxPx) cur = cand;
            else { lines.push(cur); cur = w; }
        }
        if (cur) lines.push(cur);
        return lines.map(l => ({ img: renderArabic(l, pt, bold, color) }));
    }

    /* ---------- PDF writer ---------- */

    class Writer {
        constructor(title, pat) {
            const JsPDF = getJsPDF();
            if (!JsPDF) throw new Error('jsPDF unavailable');
            this.doc = new JsPDF({ unit: 'mm', format: 'a4' });
            this.cfg = app.getConfig();
            this.title = title;
            this.mrn = pat.id;
            this.patName = pat.name;
            this.logo = this.cfg.logoData || DEFAULT_LOGO_DATA;
            try {
                const p = this.doc.getImageProperties(this.logo);
                this.ratio = p.width / p.height;
            } catch (e) { this.ratio = 1.4; }

            this.drawFirstHeader();
            this.y = 53;
        }

        setFont(size, style = 'normal', color = C.text) {
            this.doc.setFont('helvetica', style);
            this.doc.setFontSize(size);
            this.doc.setTextColor(...color);
        }

        addLogo(x, y, h) {
            const w = h * this.ratio;
            this.doc.addImage(this.logo, imgFormat(this.logo), x, y, w, h);
            return w;
        }

        // Draw one line item (plain text or a rendered Arabic image) with its baseline at `base`.
        drawItem(item, x, base, pt, style, color) {
            if (item.img) {
                const im = item.img;
                const centre = base - 0.35 * pt * 0.3528;
                this.doc.addImage(im.src, 'PNG', x, centre - im.h / 2, im.w, im.h);
            } else {
                this.setFont(pt, style, color);
                this.doc.text(item.t, x, base);
            }
        }

        // Text anchored at the right edge (Arabic-aware).
        drawRight(text, xRight, base, pt, style, color) {
            if (isArabic(text)) {
                const im = renderArabic(text, pt, style === 'bold', color);
                this.drawItem({ img: im }, xRight - im.w, base, pt, style, color);
            } else {
                this.setFont(pt, style, color);
                this.doc.text(String(text), xRight, base, { align: 'right' });
            }
        }

        // Wrap a string into line items that fit a width (mm).
        lineItems(str, maxMm, pt, style, color) {
            if (isArabic(str)) return wrapArabic(str, maxMm, pt, style === 'bold', color);
            this.setFont(pt, style, color);
            return this.doc.splitTextToSize(str, maxMm).map(t => ({ t }));
        }

        rule(y) {
            const d = this.doc;
            d.setFillColor(...C.green); d.rect(M, y, CW * 0.72, 1.1, 'F');
            d.setFillColor(...C.red);   d.rect(M + CW * 0.72, y, CW * 0.28, 1.1, 'F');
        }

        drawFirstHeader() {
            const d = this.doc;
            const logoH = 24;
            const logoW = this.addLogo(M, 7, logoH);
            const tx = M + logoW + 7;

            this.setFont(16, 'bold', C.green);
            d.text(this.cfg.hospitalName.toUpperCase(), tx, 16);
            this.setFont(8.5, 'normal', C.muted);
            d.text(this.cfg.tagline || 'Patient Care • Clinical Documentation', tx, 22);
            const contact = [this.cfg.address, this.cfg.phone ? `Tel: ${this.cfg.phone}` : ''].filter(Boolean).join('   |   ');
            if (contact) d.text(contact, tx, 27.5);

            this.drawRight(`Printed ${fmtDate(new Date(), true)}`, M + CW, 16, 8, 'normal', C.muted);
            this.rule(33.5);

            // Title band: document title on the left, patient name on the right
            d.setFillColor(...C.navy);
            d.roundedRect(M, 38, CW, 10, 1.5, 1.5, 'F');
            this.setFont(12.5, 'bold', C.white);
            d.text(this.title, M + 5, 44.6);
            this.drawRight(this.patName, M + CW - 5, 44.6, 10, 'bold', C.white);
        }

        drawCompactHeader() {
            const d = this.doc;
            const h = 9;
            const w = this.addLogo(M, 5, h);
            this.setFont(9.5, 'bold', C.green);
            d.text(this.cfg.hospitalName.toUpperCase(), M + w + 3, 10.6);
            this.setFont(8, 'normal', C.muted);
            d.text(`${this.title}   •   MRN ${this.mrn}`, M + CW - 60, 10.6);
            this.drawRight(this.patName, M + CW, 10.6, 8, 'bold', C.navy);
            this.rule(14.5);
            this.y = 22;
        }

        newPage() {
            this.doc.addPage();
            this.drawCompactHeader();
        }

        ensure(h) {
            if (this.y + h > PAGE_BOTTOM) this.newPage();
        }

        fit(str, maxW) {
            const d = this.doc;
            let s = String(str);
            if (d.getTextWidth(s) <= maxW) return s;
            while (s.length > 1 && d.getTextWidth(s + '...') > maxW) s = s.slice(0, -1);
            return s + '...';
        }

        section(title) {
            this.ensure(16);
            this.y += 2;
            this.setFont(10, 'bold', C.green);
            this.doc.text(title.toUpperCase(), M, this.y + 4);
            this.doc.setDrawColor(...C.greenLine);
            this.doc.setLineWidth(0.4);
            this.doc.line(M, this.y + 5.8, M + CW, this.y + 5.8);
            this.y += 9;
        }

        subhead(text) {
            this.ensure(7);
            this.setFont(8, 'bold', C.navy);
            this.doc.text(text, M + 3, this.y + 3.5);
            this.y += 5.5;
        }

        para(text, opts = {}) {
            const size = opts.size || 9;
            const color = opts.color || C.text;
            const style = opts.style || 'normal';
            const lh = size * 0.3528 * 1.45;
            const width = CW - 6;
            const str = (text === undefined || text === null || String(text).trim() === '') ? (opts.empty || '-') : String(text);
            for (const raw of str.split('\n')) {
                const items = raw.trim() === '' ? [{ t: '' }] : this.lineItems(raw.replace(/\s+$/, ''), width, size, style, color);
                for (const item of items) {
                    this.ensure(lh);
                    this.drawItem(item, M + 3, this.y + lh * 0.75, size, style, color);
                    this.y += lh;
                }
            }
            this.y += 2;
        }

        // Patient / referral information card
        infoGrid(pairs, cols = 3) {
            const d = this.doc;
            const cw = CW / cols;
            const rowH = 11.5;
            const rows = Math.ceil(pairs.length / cols);
            const h = rows * rowH + 3;
            this.ensure(h + 4);
            const y0 = this.y;

            d.setFillColor(...C.greenPale);
            d.setDrawColor(...C.greenLine);
            d.setLineWidth(0.25);
            d.roundedRect(M, y0, CW, h, 2, 2, 'FD');

            pairs.forEach(([label, value, alert], i) => {
                const col = i % cols, row = Math.floor(i / cols);
                const x = M + col * cw + 4;
                const yy = y0 + 3 + row * rowH;
                this.setFont(6.5, 'bold', C.muted);
                d.text(String(label).toUpperCase(), x, yy + 2.6);
                const color = alert === 'red' ? C.red : alert === 'blue' ? C.blue : C.navy;
                const v = nz(value);
                if (isArabic(v)) {
                    let im = renderArabic(v, 9, true, color);
                    if (im.w > cw - 8) { const s = (cw - 8) / im.w; im = { src: im.src, w: im.w * s, h: im.h * s }; }
                    this.drawItem({ img: im }, x, yy + 7.4, 9, 'bold', color);
                } else {
                    this.setFont(9, 'bold', color);
                    d.text(this.fit(v, cw - 8), x, yy + 7.4);
                }
            });

            d.setDrawColor(...C.greenLine);
            for (let c = 1; c < cols; c++) d.line(M + c * cw, y0 + 2, M + c * cw, y0 + h - 2);
            this.y = y0 + h + 4;
        }

        vitals(v = {}) {
            const d = this.doc;
            const items = [['BP', v.bp, 'mmHg'], ['HR', v.hr, '/min'], ['RR', v.rr, '/min'], ['Temp', v.temp, 'C'], ['SpO2', v.spo2, '%'], ['GCS', v.gcs, '/15']];
            const gap = 2, bw = (CW - gap * 5) / 6, bh = 13;
            this.ensure(bh + 6);
            items.forEach(([lbl, val, unit], i) => {
                const x = M + i * (bw + gap), y = this.y;
                d.setFillColor(...C.white);
                d.setDrawColor(...C.border);
                d.setLineWidth(0.25);
                d.roundedRect(x, y, bw, bh, 1.5, 1.5, 'FD');
                d.setFillColor(...C.green);
                d.rect(x + 1.5, y, bw - 3, 1.1, 'F');
                this.setFont(6.5, 'bold', C.muted);
                d.text(this.fit(`${lbl} (${unit})`, bw - 4), x + 2, y + 5);
                this.setFont(9.5, 'bold', C.navy);
                d.text(this.fit(nz(val), bw - 4), x + 2, y + 10.2);
            });
            this.y += bh + 4;
        }

        table(headers, rows, widths) {
            const d = this.doc;
            const total = widths.reduce((a, b) => a + b, 0);
            const cols = widths.map(w => (w / total) * CW);
            const lh = 3.9, pad = 1.8;

            const drawHead = () => {
                this.ensure(9);
                d.setFillColor(...C.green);
                d.rect(M, this.y, CW, 6.5, 'F');
                this.setFont(8, 'bold', C.white);
                let x = M;
                headers.forEach((h, i) => { d.text(h, x + 2, this.y + 4.4); x += cols[i]; });
                this.y += 6.5;
            };

            drawHead();
            if (!rows.length) { this.para('None recorded.', { size: 8.5 }); return; }

            rows.forEach((row, idx) => {
                const cells = row.map((c, i) => this.lineItems(nz(c), cols[i] - 4, 8.5, 'normal', C.text));
                const n = Math.max(...cells.map(c => c.length));
                const rh = n * lh + pad * 2;
                if (this.y + rh > PAGE_BOTTOM) { this.newPage(); drawHead(); }
                if (idx % 2 === 1) { d.setFillColor(...C.zebra); d.rect(M, this.y, CW, rh, 'F'); }
                let x = M;
                cells.forEach((items, i) => {
                    items.forEach((item, k) => this.drawItem(item, x + 2, this.y + pad + 2.7 + k * lh, 8.5, 'normal', C.text));
                    x += cols[i];
                });
                this.y += rh;
                d.setDrawColor(...C.border);
                d.setLineWidth(0.2);
                d.line(M, this.y, M + CW, this.y);
            });
            this.y += 3;
        }

        signatures(items) {
            const d = this.doc;
            const cols = 2, cw = CW / cols, rh = 17;
            const rowsN = Math.ceil(items.length / cols);
            this.ensure(rowsN * rh + 4);
            items.forEach((it, i) => {
                const x = M + (i % cols) * cw, y = this.y + Math.floor(i / cols) * rh;
                d.setDrawColor(...C.border);
                d.setLineWidth(0.25);
                d.rect(x, y, cw, rh);
                this.setFont(7.5, 'bold', C.navy);
                d.text(it.label, x + 3, y + 4.5);
                if (it.value) {
                    if (isArabic(it.value)) {
                        let im = renderArabic(it.value, 9, false, C.text);
                        if (im.w > cw - 6) { const s = (cw - 6) / im.w; im = { src: im.src, w: im.w * s, h: im.h * s }; }
                        this.drawItem({ img: im }, x + 3, y + 10.5, 9, 'normal', C.text);
                    } else {
                        this.setFont(9, 'normal', C.text);
                        d.text(this.fit(it.value, cw - 6), x + 3, y + 10.5);
                    }
                }
                d.setDrawColor(...C.muted);
                d.line(x + 3, y + rh - 3, x + cw - 3, y + rh - 3);
            });
            this.y += rowsN * rh + 4;
        }

        attachments(investigations) {
            investigations.filter(i => i.fileData).forEach(inv => {
                this.newPage();
                this.setFont(10, 'bold', C.navy);
                this.doc.text(`ATTACHED RESULT: ${inv.name} (${nz(inv.date)})`, M, this.y + 3);
                this.y += 9;
                try {
                    const p = this.doc.getImageProperties(inv.fileData);
                    let w = CW, h = w * p.height / p.width;
                    const maxH = PAGE_BOTTOM - this.y - 2;
                    if (h > maxH) { h = maxH; w = h * p.width / p.height; }
                    this.doc.addImage(inv.fileData, imgFormat(inv.fileData), M + (CW - w) / 2, this.y, w, h);
                } catch (e) {
                    this.para('The attached image could not be embedded in this document.');
                }
            });
        }

        finish() {
            const d = this.doc;
            const total = d.internal.getNumberOfPages();
            for (let i = 1; i <= total; i++) {
                d.setPage(i);
                d.setDrawColor(...C.border);
                d.setLineWidth(0.3);
                d.line(M, FOOTER_Y - 4, M + CW, FOOTER_Y - 4);
                this.setFont(7, 'normal', C.muted);
                d.text(`${this.cfg.hospitalName}  •  Confidential medical record`, M, FOOTER_Y);
                d.text(`Page ${i} of ${total}`, M + CW, FOOTER_Y, { align: 'right' });
            }
            return d;
        }
    }

    function fileName(kind, pat) {
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return `${safeName(pat.name)}_${pat.id}_${kind}_${stamp}.pdf`;
    }

    /* ---------- Discharge summary ---------- */

    function buildDischarge(pat, f) {
        const w = new Writer('DISCHARGE SUMMARY', pat);
        w.infoGrid([
            ['Patient name', pat.name],
            ['MRN / hospital no.', pat.id],
            ['Age / sex', `${pat.age} yrs / ${pat.sex}`],
            ['Ward / room / bed', pat.location],
            ['Admission date', fmtDate(f.admitDate, true)],
            ['Discharge date', fmtDate(f.dischargeDate, true)],
            ['Consultant / doctor in charge', pat.doctor],
            ['Discharge destination', f.destination],
            ['Allergy status', allergyText(pat), pat.allergyStatus === 'Allergies Present' ? 'red' : undefined]
        ], 3);

        w.section('Presenting complaint & history of presenting illness');
        w.para(f.history, { empty: 'No history documented' });

        w.section('Relevant past medical / surgical history and allergies');
        w.para(`Past medical history: ${pat.pmh.join(', ') || 'None documented'}\nPast surgical history: ${pat.surgical || 'None documented'}\nChronic illness: ${pat.chronicIllness || 'None documented'}\nAllergies: ${allergyText(pat)}`);

        w.section('Examination findings on admission and at discharge');
        w.subhead('Vitals at discharge');
        w.vitals(f.vitals);
        w.para(`On admission:\n${clinical.examLines(pat).filter(l => !l.startsWith('Vitals:')).join('\n') || 'Not documented'}\n\nAt discharge:\n${f.exam || 'Not documented'}`);

        w.section('Investigations and key results');
        w.table(['Date', 'Investigation', 'Status', 'Result'], parseRows(f.inv, 4), [22, 58, 24, 78]);

        w.section('Final diagnosis (primary and associated diagnoses)');
        w.para(f.diagnosis);

        w.section('Treatment and procedures during admission');
        w.para(f.treatment);

        w.section('Condition at discharge');
        w.para(f.condition);

        w.section('Discharge medications');
        w.table(['Drug', 'Dose', 'Route', 'Frequency', 'Dose times', 'Duration'], parseRows(f.meds, 6), [40, 22, 16, 28, 34, 42]);

        w.section('Follow-up plan, pending results, warning signs & advice');
        w.para(f.followUp);
        if (f.pending) w.para(`Pending results: ${f.pending}`);

        w.signatures([
            { label: 'Discharging doctor name & signature', value: pat.doctor },
            { label: 'Date / time', value: fmtDate(f.dischargeDate, true) },
            { label: 'Consultant signature (if required)' },
            { label: 'Contact / extension', value: f.contact }
        ]);

        w.attachments(pat.investigations);
        return w;
    }

    function readDischargeForm() {
        const v = (id) => $(id).value.trim();
        const f = {
            admitDate: $('dcAdmit').value ? new Date($('dcAdmit').value).toISOString() : clinical.getPat().admissionDate,
            dischargeDate: $('dcDate').value ? new Date($('dcDate').value).toISOString() : new Date().toISOString(),
            destination: v('dcDestination'),
            history: v('dcHistory'),
            diagnosis: v('dcDiagnosis'),
            treatment: v('dcTreatment'),
            vitals: { bp: v('dcBP'), hr: v('dcHR'), rr: v('dcRR'), temp: v('dcTemp'), spo2: v('dcSpO2'), gcs: v('dcGCS') },
            exam: v('dcExam'),
            inv: $('dcInv').value.trim(),
            condition: v('dcCondition'),
            meds: $('dcMeds').value.trim(),
            followUp: v('dcFollowUp'),
            pending: v('dcPending'),
            contact: v('dcContact')
        };
        if (!f.destination) { alert('Enter the discharge destination (e.g. Home, Transferred, Against advice).'); $('dcDestination').focus(); return null; }
        if (!f.condition) { alert('Describe the condition at discharge.'); $('dcCondition').focus(); return null; }
        return f;
    }

    function openDischargeModal() {
        const pat = clinical.getPat();
        if (!pat) return;
        if (clinical.isDirty()) { alert('Save History & Examination first so the document includes your latest entries.'); return; }
        const d = pat.dischargeInfo || {};
        const v = d.vitals || pat.exam.vitals || {};
        $('dcAdmit').value = toLocalInput(new Date(d.admitDate || pat.admissionDate));
        $('dcDate').value = toLocalInput(d.dischargeDate ? new Date(d.dischargeDate) : (pat.dischargeDate ? new Date(pat.dischargeDate) : new Date()));
        $('dcDestination').value = d.destination || '';
        $('dcHistory').value = d.history || clinical.historyLines(pat).join('\n');
        $('dcDiagnosis').value = d.diagnosis || [pat.diagnosis, pat.chronicIllness ? `Comorbidities: ${pat.chronicIllness}` : ''].filter(Boolean).join('\n');
        $('dcTreatment').value = d.treatment || pat.plan || '';
        $('dcBP').value = v.bp || ''; $('dcHR').value = v.hr || ''; $('dcRR').value = v.rr || '';
        $('dcTemp').value = v.temp || ''; $('dcSpO2').value = v.spo2 || ''; $('dcGCS').value = v.gcs || '';
        $('dcExam').value = d.exam || '';
        $('dcInv').value = d.inv || pat.investigations.map(i => [fmtDate(i.date), i.name, i.status, i.result || '-'].join(' | ')).join('\n');
        $('dcCondition').value = d.condition || '';
        $('dcMeds').value = d.meds || pat.medsLog.map(m => [m.name, m.dose, m.route, m.freq, m.times, m.dur].join(' | ')).join('\n');
        $('dcFollowUp').value = d.followUp || 'Follow up in clinic as advised. Return immediately if symptoms worsen.';
        $('dcPending').value = d.pending || '';
        $('dcContact').value = d.contact || '';
        $('dischargeModal').style.display = 'flex';
    }

    async function executeDischargePDF() {
        const pat = clinical.getPat();
        const f = readDischargeForm();
        if (!pat || !f) return;
        pat.dischargeInfo = f;
        await db.savePatient(pat);
        buildDischarge(pat, f).finish().save(fileName('DISCHARGE', pat));
        $('dischargeModal').style.display = 'none';
        app.toast('Discharge summary saved as PDF');
    }

    /* ---------- Referral form ---------- */

    function buildReferral(pat, f) {
        const w = new Writer('PATIENT REFERRAL FORM', pat);
        w.infoGrid([
            ['Patient name', pat.name],
            ['MRN / hospital no.', pat.id],
            ['Age / sex', `${pat.age} yrs / ${pat.sex}`],
            ['Ward / room / bed', pat.location],
            ['Admission date', fmtDate(f.admitDate, true)],
            ['Referral date / time', fmtDate(f.refDate, true)],
            ['Urgency', f.urgency, /urgent|emergenc/i.test(f.urgency) ? 'red' : undefined],
            ['Referring doctor / department', `${pat.doctor}${f.dept ? ' / ' + f.dept : ''}`],
            ['Contact / extension', f.contact],
            ['Referred to (doctor / specialty / facility)', f.target],
            ['Receiving contact', f.receiving],
            ['Allergy status', allergyText(pat), pat.allergyStatus === 'Allergies Present' ? 'red' : undefined]
        ], 3);

        w.section('Reason for referral');
        w.para(f.reason, { empty: 'Not specified' });

        w.section('Relevant history, comorbidities and allergies');
        w.para(f.history, { empty: 'No history documented' });

        w.section('Examination findings and current clinical status');
        w.vitals(f.vitals);
        w.para(f.exam, { empty: 'No examination documented' });

        w.section('Investigations performed and key results');
        w.para(f.inv, { empty: 'None recorded' });

        w.section('Treatment given & response');
        w.para(f.tx, { empty: 'None recorded' });

        w.section('Current medications with doses and times');
        w.table(['Drug', 'Dose', 'Route', 'Frequency', 'Dose times', 'Duration'], parseRows(f.meds, 6), [40, 22, 16, 28, 34, 42]);

        w.section('Specific request / advice required from receiving team');
        w.para(f.request, { empty: 'Please evaluate and manage.' });

        w.section('Transport and isolation');
        w.infoGrid([
            ['Transport / escort requirements', f.transport],
            ['Isolation / infection alerts', f.isolation]
        ], 2);

        w.signatures([
            { label: 'Referring doctor signature', value: pat.doctor },
            { label: 'Date / time', value: fmtDate(f.refDate, true) },
            { label: 'Receiving doctor / facility acknowledgement', value: f.receiving },
            { label: 'Date / time' }
        ]);

        w.attachments(pat.investigations);
        return w;
    }

    function readReferralForm() {
        const v = (id) => $(id).value.trim();
        const f = {
            admitDate: $('refAdmit').value ? new Date($('refAdmit').value).toISOString() : clinical.getPat().admissionDate,
            refDate: $('refDate').value ? new Date($('refDate').value).toISOString() : new Date().toISOString(),
            target: v('refTarget'), urgency: v('refUrgency'), dept: v('refDept'), contact: v('refContact'), receiving: v('refReceiving'),
            reason: v('refReason'), history: v('refHistory'), exam: v('refExam'),
            vitals: { bp: v('refBP'), hr: v('refHR'), rr: v('refRR'), temp: v('refTemp'), spo2: v('refSpO2'), gcs: v('refGCS') },
            inv: v('refInv'), tx: v('refTx'), meds: $('refMeds').value.trim(), request: v('refRequest'),
            transport: v('refTransport'), isolation: v('refIsolation')
        };
        if (!f.target) { alert('Enter who the patient is referred to.'); $('refTarget').focus(); return null; }
        if (!f.reason) { alert('Enter the reason for referral / clinical question.'); $('refReason').focus(); return null; }
        return f;
    }

    function openReferralModal() {
        const pat = clinical.getPat();
        if (!pat) return;
        if (clinical.isDirty()) { alert('Save History & Examination first so the referral includes your latest entries.'); return; }
        const v = pat.exam.vitals || {};
        $('refAdmit').value = toLocalInput(new Date(pat.admissionDate));
        $('refDate').value = toLocalInput(new Date());
        $('refTarget').value = '';
        $('refUrgency').value = 'Routine';
        $('refDept').value = '';
        $('refContact').value = '';
        $('refReceiving').value = '';
        $('refReason').value = '';
        $('refHistory').value = [clinical.historyLines(pat).join('\n'), `PMH: ${pat.pmh.join(', ') || 'None'}`, `Allergies: ${allergyText(pat)}`].join('\n');
        $('refExam').value = clinical.examLines(pat).filter(l => !l.startsWith('Vitals:')).join('\n');
        $('refBP').value = v.bp || ''; $('refHR').value = v.hr || ''; $('refRR').value = v.rr || '';
        $('refTemp').value = v.temp || ''; $('refSpO2').value = v.spo2 || ''; $('refGCS').value = v.gcs || '';
        $('refInv').value = pat.investigations.map(i => `${fmtDate(i.date)}: ${i.name} - ${i.result || i.status}`).join('\n');
        $('refTx').value = pat.plan || '';
        $('refMeds').value = pat.medsLog.map(m => [m.name, m.dose, m.route, m.freq, m.times, m.dur].join(' | ')).join('\n');
        $('refRequest').value = 'Please evaluate and manage.';
        $('refTransport').value = 'Not required';
        $('refIsolation').value = 'None';
        $('referralModal').style.display = 'flex';
    }

    async function executeReferralPDF() {
        const pat = clinical.getPat();
        const f = readReferralForm();
        if (!pat || !f) return;
        buildReferral(pat, f).finish().save(fileName('REFERRAL', pat));
        $('referralModal').style.display = 'none';
        app.toast('Referral form saved as PDF');
    }

    /* ---------- Discharge / archive ---------- */

    async function dischargePatient() {
        const pat = clinical.getPat();
        if (!pat) return;
        if (clinical.isDirty()) { alert('Save History & Examination before discharging the patient.'); return; }
        if (!confirm(`Discharge ${pat.name}? The record will move to the archive.`)) return;
        pat.status = 'discharged';
        pat.dischargeDate = new Date().toISOString();
        await db.savePatient(pat);
        app.toast('Patient discharged and archived');
        app.navigate('archive');
    }

    async function loadArchive() {
        const pts = (await db.getAllPatients())
            .filter(p => p.status === 'discharged')
            .sort((a, b) => new Date(b.dischargeDate) - new Date(a.dischargeDate));
        $('archiveTable').querySelector('tbody').innerHTML = pts.map(p => `
            <tr><td>${fmtDate(p.dischargeDate)}</td>
            <td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.diagnosis)}</td>
            <td><button class="btn btn-outline btn-sm" onclick="clinical.loadPatient('${esc(p.id)}')">Open record</button></td></tr>
        `).join('') || '<tr><td colspan="5" class="text-muted">No discharged patients.</td></tr>';
    }

    /* ---------- Backup & restore ---------- */

    async function exportBackup() {
        const pts = await db.getAllPatients();
        const blob = new Blob([JSON.stringify(pts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HIS_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        app.toast(`Exported ${pts.length} records`);
    }

    let pendingImport = null;

    function importBackup() {
        const file = $('importFile').files[0];
        if (!file) return alert('Select a backup file first.');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const list = Array.isArray(data) ? data : (data && data.patients);
                if (!Array.isArray(list) || list.some(p => !p || !p.id)) throw new Error('invalid');
                pendingImport = list.map(normalizePatient);
                const existing = new Set((await db.getAllPatients()).map(p => p.id));
                const dup = pendingImport.filter(p => existing.has(p.id)).length;
                $('importStats').textContent = `${pendingImport.length} records in file: ${pendingImport.length - dup} new, ${dup} already exist.`;
                $('conflictList').textContent = dup ? 'Existing records with the same MRN will be replaced by the copy in the backup.' : 'No existing records will be changed.';
                $('importModal').style.display = 'flex';
            } catch (err) {
                alert('This file is not a valid backup.');
            }
        };
        reader.readAsText(file);
    }

    async function executeImport() {
        if (!pendingImport) return;
        for (const p of pendingImport) await db.savePatient(p);
        const n = pendingImport.length;
        pendingImport = null;
        $('importModal').style.display = 'none';
        $('importFile').value = '';
        app.toast(`Imported ${n} records`);
        app.navigate('dashboard');
    }

    function cancelImport() {
        pendingImport = null;
        $('importModal').style.display = 'none';
    }

    return {
        openDischargeModal, executeDischargePDF, openReferralModal, executeReferralPDF,
        dischargePatient, loadArchive, exportBackup, importBackup, executeImport, cancelImport
    };
})();
