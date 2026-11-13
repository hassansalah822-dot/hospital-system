const clinical = (function() {
    let currPat = null;
    let vitalsChart = null;
    let dirty = false;
    let editIdx = null;     // medication order currently being edited
    const $ = (id) => document.getElementById(id);

    /* ---------- Shared text builders (also used by the PDF generator) ---------- */

    // Returns e.g. ["Respiratory: Cough, Sputum"] for every system with symptoms in the given state.
    function rosLines(p, state) {
        const out = [];
        for (const [sys, map] of Object.entries(p.history.ros || {})) {
            const syms = Object.keys(map).filter(s => map[s] === state);
            if (syms.length) out.push(`${sys}: ${syms.join(', ')}`);
        }
        return out;
    }

    function historyLines(p) {
        const lines = [];
        if (p.history.cc) lines.push(`Chief complaint: ${p.history.cc}`);
        if (p.history.hpi) lines.push(`HPI: ${p.history.hpi}`);
        const pos = rosLines(p, 1);
        const neg = rosLines(p, 2);
        if (pos.length) lines.push('Positive systems review:', ...pos.map(l => '  ' + l));
        if (neg.length) lines.push('Pertinent negatives:', ...neg.map(l => '  ' + l));
        return lines;
    }

    function examLines(p) {
        const v = p.exam.vitals || {};
        const lines = [];
        const vit = [['BP', v.bp], ['HR', v.hr], ['RR', v.rr], ['Temp', v.temp], ['SpO2', v.spo2], ['GCS', v.gcs]]
            .filter(([, val]) => val).map(([k, val]) => `${k} ${val}`);
        if (vit.length) lines.push('Vitals: ' + vit.join(' | '));
        if (p.exam.appearance && p.exam.appearance.length) lines.push('General appearance: ' + p.exam.appearance.join(', '));
        if (p.exam.general) lines.push('General notes: ' + p.exam.general);
        for (const sys of EXAM_SYSTEMS) {
            const s = (p.exam.systemic || {})[sys];
            if (!s || !s.status) continue;
            lines.push(`${sys}: ${s.status === 'normal' ? 'Normal' : 'Abnormal'}${s.notes ? ' - ' + s.notes : ''}`);
        }
        if (p.exam.systems) lines.push('Other systemic findings: ' + p.exam.systems);
        return lines;
    }

    /* ---------- Loading & header ---------- */

    async function loadPatient(id) {
        if (dirty && !confirm('You have unsaved history / examination changes. Leave without saving?')) return;
        const pat = await db.getPatient(id);
        if (!pat) { alert('Patient record not found.'); return; }
        currPat = pat;
        dirty = false;
        editIdx = null;
        renderHeader();
        renderOverview();
        renderHistoryExam();
        renderPMH();
        renderInvestigations();
        renderProgressPlan();
        renderDischargeTab();
        openTab('tab-overview');
        app.navigate('patient-record');
        app.setTitle(`${currPat.name} (${currPat.id})`);
    }

    function renderHeader() {
        const p = currPat;
        const hdr = $('activePatientHeader');
        let alert = '';
        if (p.chronicIllness) alert += `<div class="tag tag-blue">CHRONIC: ${esc(p.chronicIllness)}</div>`;
        if (p.allergyStatus === 'Allergies Present') alert += `<div class="tag tag-red">ALLERGY: ${esc(p.allergyDetails)}</div>`;
        else alert += `<div class="tag tag-amber">${esc(p.allergyStatus)}</div>`;
        const statusTag = p.status === 'discharged' ? '<span class="tag tag-amber">DISCHARGED</span>' : '<span class="tag tag-green">ACTIVE</span>';

        hdr.innerHTML = `
            <div>
                <h2 class="ph-name">${esc(p.name)} <small>MRN ${esc(p.id)}</small> ${statusTag}</h2>
                <p class="text-muted">${esc(p.age)} yrs &middot; ${esc(p.sex)} &middot; ${esc(p.location)} &middot; ${esc(p.doctor)}</p>
                <p><strong>Diagnosis:</strong> ${esc(p.diagnosis)}</p>
            </div>
            <div class="ph-tags">${(p.episodes || []).length ? `<div class="tag tag-blue">READMISSION #${p.episodes.length + 1}</div>` : ''}${alert}</div>`;
        hdr.className = (p.allergyStatus === 'Allergies Present' || p.chronicIllness) ? 'patient-header alert-border' : 'patient-header';
    }

    function openTab(id) {
        document.querySelectorAll('.clinical-tab').forEach(t => t.classList.remove('active-tab'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
        $(id).classList.add('active-tab');
        if (id === 'tab-overview') renderOverview();
        if (id === 'tab-progress') renderVitalsChart();
        if (id === 'tab-previous') renderPrevious();
    }

    function setDirty(state) {
        dirty = state;
        const el = $('hxStatus');
        if (el) {
            el.textContent = state ? '● Unsaved changes' : '✓ All changes saved';
            el.className = 'save-status ' + (state ? 'dirty' : 'clean');
        }
    }

    /* ---------- History & Examination ---------- */

    function renderHistoryExam() {
        const p = currPat;
        const v = p.exam.vitals || {};
        const h = p.history;

        const rosHtml = Object.entries(ROS_SYSTEMS).map(([sys, syms]) => `
            <div class="ros-group">
                <h4>${esc(sys)}</h4>
                <div class="chip-row">
                    ${syms.map(sym => {
                        const st = (h.ros[sys] || {})[sym] || 0;
                        const cls = st === 1 ? ' pos' : st === 2 ? ' neg' : '';
                        return `<button type="button" class="sym-btn${cls}" data-sys="${esc(sys)}" data-sym="${esc(sym)}" data-state="${st}" onclick="clinical.toggleSym(this)">${esc(sym)}</button>`;
                    }).join('')}
                </div>
            </div>`).join('');

        const appearanceHtml = APPEARANCE_FINDINGS.map(f => {
            const sel = p.exam.appearance.includes(f);
            return `<button type="button" class="sym-btn${sel ? ' sel' : ''}" data-app="${esc(f)}" onclick="clinical.toggleAppearance(this)">${esc(f)}</button>`;
        }).join('');

        const systemicHtml = EXAM_SYSTEMS.map(sys => {
            const s = p.exam.systemic[sys] || {};
            return `
            <div class="sys-exam-row" data-sysrow="${esc(sys)}" data-status="${esc(s.status || '')}">
                <div class="sys-exam-name">${esc(sys)}</div>
                <div class="chip-row">
                    <button type="button" class="sym-btn${s.status === 'normal' ? ' neg' : ''}" data-status="normal" onclick="clinical.setSystemStatus(this,'normal')">Normal</button>
                    <button type="button" class="sym-btn${s.status === 'abnormal' ? ' pos' : ''}" data-status="abnormal" onclick="clinical.setSystemStatus(this,'abnormal')">Abnormal</button>
                </div>
                <textarea class="form-control sys-notes" rows="2" placeholder="Key findings (e.g. 'Bibasal crepitations, no effusion')">${esc(s.notes || '')}</textarea>
            </div>`;
        }).join('');

        $('tab-history-exam').innerHTML = `
            <div class="section-head">
                <h3>History &amp; Physical Examination</h3>
                <span id="hxStatus" class="save-status clean">✓ All changes saved</span>
            </div>

            <div class="form-group">
                <label>Chief Complaint <span class="req">*</span></label>
                <input type="text" id="hxCC" class="form-control" placeholder="e.g. Fever and cough for 5 days" value="${esc(h.cc)}">
            </div>
            <div class="form-group">
                <label>History of Presenting Illness (HPI)</label>
                <textarea id="hpiText" class="form-control" rows="4" placeholder="Onset, duration, progression, aggravating / relieving factors, treatment taken before admission">${esc(h.hpi)}</textarea>
            </div>

            <div class="sub-section">
                <h4>Review of Systems</h4>
                <p class="hint">Click once = <span class="pos-text">Positive</span>, twice = <span class="neg-text">Negative</span>, third click = clear (not asked).</p>
                <div class="ros-grid">${rosHtml}</div>
            </div>

            <div class="sub-section">
                <h4>Physical Examination</h4>
                <div class="form-row vitals-row">
                    ${[['vBP', 'BP', 'mmHg', v.bp], ['vHR', 'HR', 'bpm', v.hr], ['vRR', 'RR', '/min', v.rr], ['vTemp', 'Temp', '°C', v.temp], ['vO2', 'SpO2', '%', v.spo2], ['vGCS', 'GCS', '/15', v.gcs]]
                        .map(([id, lbl, unit, val]) => `<div class="form-group"><label>${lbl} <small>${unit}</small></label><input type="text" id="${id}" class="form-control" value="${esc(val || '')}"></div>`).join('')}
                </div>

                <div class="form-group">
                    <label>General Appearance</label>
                    <div class="chip-row">${appearanceHtml}</div>
                    <textarea id="exGen" class="form-control" rows="2" style="margin-top:0.6rem" placeholder="Additional general findings">${esc(p.exam.general)}</textarea>
                </div>

                <div class="form-group">
                    <label>Systemic Examination</label>
                    <div class="sys-exam-grid">${systemicHtml}</div>
                </div>

                <div class="form-group">
                    <label>Other systemic findings</label>
                    <textarea id="exOther" class="form-control" rows="2">${esc(p.exam.systems)}</textarea>
                </div>
            </div>

            <div class="sticky-actions">
                <button class="btn btn-primary" onclick="clinical.saveHistoryExam()">Save History &amp; Examination</button>
            </div>`;
    }

    function toggleSym(el) {
        const state = (parseInt(el.dataset.state, 10) + 1) % 3;
        el.dataset.state = state;
        el.className = 'sym-btn' + (state === 1 ? ' pos' : state === 2 ? ' neg' : '');
        setDirty(true);
    }

    function toggleAppearance(el) {
        el.classList.toggle('sel');
        setDirty(true);
    }

    function setSystemStatus(btn, status) {
        const row = btn.closest('.sys-exam-row');
        const next = row.dataset.status === status ? '' : status;
        row.dataset.status = next;
        row.querySelectorAll('[data-status]').forEach(b => {
            const active = b.dataset.status === next;
            b.className = 'sym-btn' + (active ? (next === 'normal' ? ' neg' : ' pos') : '');
        });
        setDirty(true);
    }

    async function saveHistoryExam() {
        const p = currPat;
        const cc = $('hxCC').value.trim();
        if (!cc) { alert('Chief complaint is required.'); $('hxCC').focus(); return; }

        p.history.cc = cc;
        p.history.hpi = $('hpiText').value.trim();
        const ros = {};
        document.querySelectorAll('#tab-history-exam .sym-btn[data-sys]').forEach(b => {
            const st = parseInt(b.dataset.state, 10);
            if (st) { ros[b.dataset.sys] = ros[b.dataset.sys] || {}; ros[b.dataset.sys][b.dataset.sym] = st; }
        });
        p.history.ros = ros;
        p.history.text = historyLines(p).join('\n');

        p.exam.appearance = [...document.querySelectorAll('#tab-history-exam [data-app].sel')].map(b => b.dataset.app);
        p.exam.general = $('exGen').value.trim();
        p.exam.vitals = { bp: $('vBP').value, hr: $('vHR').value, rr: $('vRR').value, temp: $('vTemp').value, spo2: $('vO2').value, gcs: $('vGCS').value };
        const systemic = {};
        document.querySelectorAll('#tab-history-exam .sys-exam-row').forEach(row => {
            systemic[row.dataset.sysrow] = { status: row.dataset.status || '', notes: row.querySelector('.sys-notes').value.trim() };
        });
        p.exam.systemic = systemic;
        p.exam.systems = $('exOther').value.trim();

        await db.savePatient(p);
        setDirty(false);
        app.toast('History & examination saved');
        renderOverview();
    }

    /* ---------- Background ---------- */

    function renderPMH() {
        const p = currPat;
        $('tab-pmh').innerHTML = `
            <h3>Past Medical, Surgical, Drug &amp; Social History</h3>
            <div class="form-group"><label>Past Medical Conditions <small>(comma separated)</small></label><input type="text" id="pmhList" class="form-control" value="${esc(p.pmh.join(', '))}"></div>
            <div class="form-group"><label>Past Surgical History</label><input type="text" id="surgHist" class="form-control" value="${esc(p.surgical || '')}"></div>
            <div class="form-group"><label>Chronic Home Medications <small>(comma separated)</small></label><input type="text" id="drugList" class="form-control" value="${esc(p.drugs.join(', '))}"></div>
            <div class="form-group"><label>Social History</label><textarea id="socialHist" class="form-control" rows="2">${esc(p.social)}</textarea></div>
            <button class="btn btn-primary" onclick="clinical.savePMH()">Save Background</button>`;
    }

    async function savePMH() {
        const split = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
        currPat.pmh = split($('pmhList').value);
        currPat.drugs = split($('drugList').value);
        currPat.surgical = $('surgHist').value.trim();
        currPat.social = $('socialHist').value.trim();
        await db.savePatient(currPat);
        app.toast('Background saved');
        renderOverview();
    }

    /* ---------- Investigations ---------- */

    function renderInvestigations() {
        const today = new Date().toISOString().split('T')[0];
        const rows = currPat.investigations.map((inv, i) => {
            const color = inv.status === 'Requested' ? 'var(--amber)' : 'var(--green-main)';
            const fileBtn = inv.fileData ? `<button class="btn btn-sm btn-outline" onclick="clinical.viewImage(${i})">View</button>` : '-';
            return `<tr><td>${esc(inv.date)}</td><td>${esc(inv.name)}</td>
                <td><span style="color:${color};font-weight:bold">${esc(inv.status)}</span></td>
                <td>${esc(inv.result) || '-'}</td><td>${fileBtn}</td>
                <td><button class="btn btn-outline btn-sm" onclick="clinical.delInv(${i})">Delete</button></td></tr>`;
        }).join('');

        $('tab-investigations').innerHTML = `
            <h3>Investigations</h3>
            <div class="form-row inv-form">
                <div class="form-group"><label>Test Name</label><input type="text" id="invName" class="form-control" placeholder="e.g. FBC, Chest X-ray"></div>
                <div class="form-group"><label>Date</label><input type="date" id="invDate" class="form-control" value="${today}"></div>
                <div class="form-group"><label>Status</label><select id="invStatus" class="form-control"><option>Requested</option><option>Completed</option></select></div>
                <div class="form-group"><label>Result</label><input type="text" id="invResult" class="form-control" placeholder="Key result"></div>
                <div class="form-group"><label>Attach Image / Report</label><input type="file" id="invFile" class="form-control" accept="image/*"></div>
                <div class="form-group"><button class="btn btn-primary" onclick="clinical.addInv()" style="width:100%">Add</button></div>
            </div>
            <div class="table-wrap"><table class="table">
                <thead><tr><th>Date</th><th>Test</th><th>Status</th><th>Result</th><th>File</th><th>Action</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" class="text-muted">No investigations recorded.</td></tr>'}</tbody>
            </table></div>`;
    }

    async function addInv() {
        const name = $('invName').value.trim();
        if (!name) { alert('Enter a test name.'); return; }
        const invObj = { name, date: $('invDate').value, status: $('invStatus').value, result: $('invResult').value.trim(), fileData: null };
        const file = $('invFile').files[0];
        if (file && file.size > 4 * 1024 * 1024) { alert('Please attach an image smaller than 4 MB.'); return; }

        const commit = async () => {
            currPat.investigations.push(invObj);
            await db.savePatient(currPat);
            renderInvestigations();
            renderOverview();
            app.toast('Investigation added');
        };
        if (file) {
            const reader = new FileReader();
            reader.onload = async (e) => { invObj.fileData = e.target.result; await commit(); };
            reader.readAsDataURL(file);
        } else {
            await commit();
        }
    }

    async function delInv(idx) {
        if (!confirm('Delete this investigation?')) return;
        currPat.investigations.splice(idx, 1);
        await db.savePatient(currPat);
        renderInvestigations();
        renderOverview();
    }

    /* ---------- Image gallery viewer ---------- */

    let gallery = [];       // [{ inv, i }] images of the open patient, in record order
    let gIdx = 0;
    let gTimer = null;

    function viewerOpen() { return $('imageViewerModal').style.display === 'flex'; }

    function viewImage(invIndex, epIndex = null) {
        const source = epIndex === null ? currPat.investigations : currPat.episodes[epIndex].investigations;
        gallery = source.map((inv, i) => ({ inv, i })).filter(x => x.inv.fileData);
        gIdx = gallery.findIndex(x => x.i === invIndex);
        if (gIdx < 0) return;
        $('imageViewerModal').style.display = 'flex';
        document.body.classList.add('viewer-open');
        showGallery(0, true);
    }

    function showGallery(dir = 0, immediate = false) {
        const n = gallery.length;
        const item = gallery[gIdx];
        if (!item) return;
        const img = $('viewerImage');
        const paint = () => {
            img.src = item.inv.fileData;
            img.alt = item.inv.name;
            $('viewerCaption').textContent = [item.inv.name, item.inv.date ? new Date(item.inv.date).toLocaleDateString() : '', item.inv.result ? `Result: ${item.inv.result}` : ''].filter(Boolean).join('  ·  ');
            $('viewerCount').textContent = `${gIdx + 1} / ${n}`;
            document.querySelectorAll('.viewer-nav').forEach(b => b.style.visibility = n > 1 ? 'visible' : 'hidden');
            img.classList.remove('leaving');
        };
        // Preload neighbours so moving between images is instant
        [gIdx - 1, gIdx + 1].forEach(k => { const g = gallery[(k + n) % n]; if (g && n > 1) new Image().src = g.inv.fileData; });

        if (immediate) { img.style.setProperty('--dir', 0); paint(); return; }
        img.style.setProperty('--dir', dir);
        img.classList.add('leaving');          // slide out
        clearTimeout(gTimer);
        gTimer = setTimeout(paint, 170);       // swap, then slide back in
    }

    function galleryStep(d) {
        const n = gallery.length;
        if (n < 2) return;
        gIdx = (gIdx + d + n) % n;
        showGallery(d);
    }

    function closeViewer() {
        $('imageViewerModal').style.display = 'none';
        document.body.classList.remove('viewer-open');
        clearTimeout(gTimer);
    }

    /* ---------- Progress, vitals & medications ---------- */

    function renderProgressPlan() {
        const p = currPat;
        const e = editIdx !== null ? p.medsLog[editIdx] : null;
        const val = (k) => esc(e ? e[k] : '');

        const meds = p.medsLog.map((m, i) => `
            <tr class="${i === editIdx ? 'row-editing' : ''}">
                <td><b>${esc(m.name)}</b></td><td>${esc(m.dose)}</td><td>${esc(m.route)}</td><td>${esc(m.freq)}</td>
                <td>${esc(m.times) || '-'}</td><td>${esc(m.dur) || '-'}</td>
                <td class="row-actions">
                    <button class="btn btn-sm btn-outline" onclick="clinical.editMed(${i})">Edit</button>
                    <button class="btn btn-sm btn-outline" onclick="clinical.delMed(${i})">Delete</button>
                </td></tr>`).join('');

        const notes = p.progress.slice().reverse().map(n => `
            <div class="note-card">
                <small class="text-muted">${new Date(n.date).toLocaleString()} &middot; ${esc(n.author)}</small>
                <p class="note-text">${esc(n.text)}</p>
            </div>`).join('') || '<p class="text-muted">No progress notes yet.</p>';

        $('tab-progress').innerHTML = `
            <h3>Management Plan</h3>
            <div class="form-group">
                <label>Plan notes <small>(investigations, monitoring, procedures, diet, nursing care)</small></label>
                <textarea id="planText" class="form-control" rows="3" placeholder="Drugs are entered one per row in Medication Orders below">${esc(p.plan)}</textarea>
            </div>
            <button class="btn btn-primary" onclick="clinical.savePlan()">Save Plan Notes</button>

            <div class="sub-section">
                <h4>Medication Orders</h4>
                <p class="hint">One drug per row. Name, dose, route and frequency are required. Dose times are optional.</p>
                <div class="form-row med-form">
                    <input type="text" id="medName" class="form-control" placeholder="Drug name *" value="${val('name')}">
                    <input type="text" id="medDose" class="form-control" placeholder="Dose * (e.g. 1 g)" value="${val('dose')}">
                    <input type="text" id="medRoute" class="form-control" placeholder="Route * (PO, IV, IM…)" value="${val('route')}">
                    <input type="text" id="medFreq" class="form-control" placeholder="Frequency * (OD, BD, TDS…)" value="${val('freq')}">
                    <input type="text" id="medTimes" class="form-control" placeholder="Dose times (08:00, 14:00, 20:00)" value="${val('times')}">
                    <input type="text" id="medDur" class="form-control" placeholder="Duration (5 days)" value="${val('dur')}">
                    <button class="btn btn-primary" onclick="clinical.addMed()">${e ? 'Save Order' : 'Add Order'}</button>
                    ${e ? '<button class="btn btn-outline" onclick="clinical.cancelEdit()">Cancel</button>' : ''}
                </div>
                <div class="table-wrap"><table class="table">
                    <thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Dose times</th><th>Duration</th><th>Action</th></tr></thead>
                    <tbody>${meds || '<tr><td colspan="7" class="text-muted">No medication orders yet.</td></tr>'}</tbody>
                </table></div>
            </div>

            <div class="sub-section">
                <h3>Vital Signs Trend</h3>
                <div class="form-row vitals-log">
                    <input type="number" id="logHR" class="form-control" placeholder="HR (bpm)">
                    <input type="number" id="logRR" class="form-control" placeholder="RR (/min)">
                    <input type="number" id="logTemp" class="form-control" placeholder="Temp (°C)" step="0.1">
                    <input type="number" id="logSpO2" class="form-control" placeholder="SpO2 (%)">
                    <button class="btn btn-primary" onclick="clinical.logVitals()">Log Vitals Now</button>
                </div>
                <div class="chart-box"><canvas id="vitalsChart"></canvas></div>
            </div>

            <div class="sub-section">
                <h3>Progress Notes (SOAP)</h3>
                <textarea id="soapNote" class="form-control" rows="3" placeholder="S: …  O: …  A: …  P: …"></textarea>
                <button class="btn btn-primary" onclick="clinical.addNote()" style="margin-top:1rem">Add Note</button>
                <div style="margin-top:1.5rem">${notes}</div>
            </div>`;
    }

    async function logVitals() {
        const entry = {
            date: new Date().toISOString(),
            hr: $('logHR').value, rr: $('logRR').value, temp: $('logTemp').value, spo2: $('logSpO2').value
        };
        if (!entry.hr && !entry.rr && !entry.temp && !entry.spo2) { alert('Enter at least one vital sign.'); return; }
        currPat.vitalsLog.push(entry);
        await db.savePatient(currPat);
        renderProgressPlan();
        renderVitalsChart();
        app.toast('Vitals logged');
    }

    function renderVitalsChart() {
        const ctx = $('vitalsChart');
        if (!ctx || typeof Chart === 'undefined') return;
        if (vitalsChart) { vitalsChart.destroy(); vitalsChart = null; }
        if (!currPat.vitalsLog.length) return;

        const labels = currPat.vitalsLog.map(v => new Date(v.date).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));
        const series = (key) => currPat.vitalsLog.map(v => (v[key] === '' || v[key] === undefined) ? null : Number(v[key]));
        vitalsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'HR (bpm)', data: series('hr'), borderColor: '#D62828', backgroundColor: '#D62828', tension: 0.25, spanGaps: true },
                    { label: 'RR (/min)', data: series('rr'), borderColor: '#0077B6', backgroundColor: '#0077B6', tension: 0.25, spanGaps: true },
                    { label: 'SpO2 (%)', data: series('spo2'), borderColor: '#008B45', backgroundColor: '#008B45', tension: 0.25, spanGaps: true }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } } }
        });
    }

    async function savePlan() { currPat.plan = $('planText').value.trim(); await db.savePatient(currPat); app.toast('Plan saved'); renderOverview(); }

    async function addMed() {
        const order = {
            name: $('medName').value.trim(), dose: $('medDose').value.trim(), route: $('medRoute').value.trim(),
            freq: $('medFreq').value.trim(), times: $('medTimes').value.trim(), dur: $('medDur').value.trim()
        };
        if (!order.name || !order.dose || !order.route || !order.freq) {
            alert('Each drug needs a name, dose, route and frequency.');
            return;
        }
        if (editIdx !== null) { currPat.medsLog[editIdx] = order; editIdx = null; }
        else currPat.medsLog.push(order);
        await db.savePatient(currPat);
        renderProgressPlan();
        renderOverview();
        app.toast('Medication order saved');
    }

    function editMed(i) {
        editIdx = i;
        renderProgressPlan();
        $('medName').focus();
    }

    function cancelEdit() {
        editIdx = null;
        renderProgressPlan();
    }

    async function delMed(idx) {
        if (!confirm('Remove this medication order?')) return;
        currPat.medsLog.splice(idx, 1);
        editIdx = null;
        await db.savePatient(currPat);
        renderProgressPlan();
        renderOverview();
    }

    async function addNote() {
        const txt = $('soapNote').value.trim();
        if (!txt) return;
        currPat.progress.push({ date: new Date().toISOString(), text: txt, author: currPat.doctor });
        await db.savePatient(currPat);
        renderProgressPlan();
    }

    /* ---------- Overview & documents ---------- */

    function renderOverview() {
        const p = currPat;
        const hist = historyLines(p);
        const exam = examLines(p);
        const invImages = p.investigations.map((inv, i) => inv.fileData ? `
            <figure class="inv-thumb">
                <img src="${inv.fileData}" alt="${esc(inv.name)}" onclick="clinical.viewImage(${i})">
                <figcaption>${esc(inv.name)}</figcaption>
            </figure>` : '').join('');
        const meds = p.medsLog.map(m => `<li>${esc(m.name)} ${esc(m.dose)} ${esc(m.route)} ${esc(m.freq)}${m.times ? ' at ' + esc(m.times) : ''} ${esc(m.dur)}</li>`).join('');

        $('tab-overview').innerHTML = `
            <h3>Patient Summary</h3>
            <div class="summary-grid">
                <div class="summary-block wide">
                    <h4>Ward Round Sticky Note</h4>
                    ${(p.roundNotes || []).length ? (p.roundNotes || []).map(n => `
                        <div class="round-note"><small class="text-muted">${esc(new Date(n.at).toLocaleString())}</small>
                        <p class="note-text" style="white-space:pre-wrap">${esc(n.text)}</p></div>`).join('') : '<p class="note-text"><span class="text-muted">No quick notes added.</span></p>'}
                </div>
                <div class="summary-block"><h4>Admission</h4>
                    <p><strong>Date:</strong> ${new Date(p.admissionDate).toLocaleString()}</p>
                    <p><strong>Ward / Bed:</strong> ${esc(p.location)}</p>
                    <p><strong>Consultant:</strong> ${esc(p.doctor)}</p>
                </div>
                <div class="summary-block"><h4>Diagnosis &amp; Alerts</h4>
                    <p><strong>Diagnosis:</strong> ${esc(p.diagnosis)}</p>
                    <p><strong>Chronic illness:</strong> ${esc(p.chronicIllness) || 'None documented'}</p>
                    <p><strong>Allergy:</strong> ${p.allergyStatus === 'Allergies Present' ? esc(p.allergyDetails) : esc(p.allergyStatus)}</p>
                </div>
                <div class="summary-block wide"><h4>Chief Complaint &amp; History</h4>
                    <p class="pre">${hist.length ? esc(hist.join('\n')) : '<span class="text-muted">No history documented.</span>'}</p>
                </div>
                <div class="summary-block wide"><h4>Examination</h4>
                    <p class="pre">${exam.length ? esc(exam.join('\n')) : '<span class="text-muted">No examination documented.</span>'}</p>
                </div>
                <div class="summary-block"><h4>Background</h4>
                    <p><strong>PMH:</strong> ${esc(p.pmh.join(', ')) || 'None'}</p>
                    <p><strong>Surgical:</strong> ${esc(p.surgical) || 'None'}</p>
                    <p><strong>Social:</strong> ${esc(p.social) || '-'}</p>
                </div>
                <div class="summary-block"><h4>Medications</h4>
                    ${meds ? `<ul class="plain-list">${meds}</ul>` : '<p class="text-muted">None charted.</p>'}
                </div>
                <div class="summary-block wide"><h4>Management Plan</h4>
                    <p class="pre">${esc(p.plan) || '<span class="text-muted">No plan documented.</span>'}</p>
                </div>
                <div class="summary-block wide"><h4>Attached Investigations</h4>
                    <div class="inv-strip">${invImages || '<span class="text-muted">No images attached.</span>'}</div>
                </div>
            </div>`;
    }

    function renderDischargeTab() {
        const p = currPat;
        $('tab-discharge').innerHTML = `
            <h3>Clinical Documents</h3>
            <p class="text-muted">Documents are generated from the patient's record. You can review and complete the editable fields before saving the PDF.</p>
            <div class="doc-actions">
                <button class="btn btn-primary" onclick="docs.openDischargeModal()">Discharge Summary (PDF)</button>
                <button class="btn btn-outline" onclick="docs.openReferralModal()">Referral Form (PDF)</button>
            </div>
            <hr style="margin:2rem 0">
            <h3 style="color:var(--red)">Discharge &amp; Archive</h3>
            <p class="text-muted">Moves the patient from the active ward list to the archive. The record is kept.</p>
            ${p.status === 'discharged'
                ? `<p class="tag tag-amber">Discharged ${new Date(p.dischargeDate).toLocaleString()}</p>
                   <p class="text-muted" style="margin:0.8rem 0">If the patient returns, open a readmission. This admission's history, investigations and plan move to Previous Admissions, and fresh pages open for the new stay.</p>
                   <button class="btn btn-primary" onclick="clinical.openReadmit()">Readmit Patient</button>`
                : `<button class="btn btn-danger" onclick="docs.dischargePatient()">Discharge Patient</button>`}`;
    }

    // Any typing in the History & Examination tab marks it as unsaved.
    document.getElementById('tab-history-exam').addEventListener('input', () => setDirty(true));

    // Keyboard and swipe navigation for the image viewer
    document.addEventListener('keydown', (e) => {
        if (!viewerOpen()) return;
        if (e.key === 'ArrowLeft') galleryStep(-1);
        else if (e.key === 'ArrowRight') galleryStep(1);
        else if (e.key === 'Escape') closeViewer();
    });
    (() => {
        let x0 = null;
        const stage = document.querySelector('#imageViewerModal .viewer-stage');
        stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        stage.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0;
            x0 = null;
            if (Math.abs(dx) > 50) galleryStep(dx < 0 ? 1 : -1);
        });
    })();

    /* ---------- Readmission & previous admissions ---------- */

    const fmtD = (d) => (d ? new Date(d).toLocaleDateString() : '-');

    // Snapshot the current stay so it stays readable after a readmission.
    function archiveCurrentEpisode(p) {
        p.episodes = (p.episodes || []).concat([{
            admissionDate: p.admissionDate, dischargeDate: p.dischargeDate || null,
            location: p.location, doctor: p.doctor, diagnosis: p.diagnosis,
            history: p.history, exam: p.exam, investigations: p.investigations, plan: p.plan,
            medsLog: p.medsLog, vitalsLog: p.vitalsLog, progress: p.progress,
            dischargeInfo: p.dischargeInfo || null
        }]);
    }

    function openReadmit() {
        const p = currPat;
        if (!p || p.status !== 'discharged') return;
        const local = (d) => { const q = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}T${q(d.getHours())}:${q(d.getMinutes())}`; };
        $('rdAdmit').value = local(new Date());
        $('rdLocation').value = p.location;
        $('rdDoctor').value = p.doctor;
        $('rdDiagnosis').value = '';
        $('rdChronic').value = p.chronicIllness || '';
        $('rdAllergyStatus').value = p.allergyStatus;
        $('rdAllergyDetails').value = p.allergyDetails || '';
        $('readmitModal').style.display = 'flex';
    }

    async function executeReadmit() {
        const p = currPat;
        const diagnosis = $('rdDiagnosis').value.trim();
        if (!diagnosis) { alert('Enter the reason for readmission / provisional diagnosis.'); $('rdDiagnosis').focus(); return; }
        const allergyStatus = $('rdAllergyStatus').value;
        const allergyDetails = $('rdAllergyDetails').value.trim();
        if (allergyStatus === 'Allergies Present' && !allergyDetails) { alert('Specify the allergies.'); return; }

        archiveCurrentEpisode(p);
        Object.assign(p, {
            admissionDate: new Date($('rdAdmit').value || Date.now()).toISOString(),
            location: $('rdLocation').value.trim(), doctor: $('rdDoctor').value, diagnosis,
            chronicIllness: $('rdChronic').value.trim(), allergyStatus,
            allergyDetails: allergyStatus === 'Allergies Present' ? allergyDetails : '',
            status: 'active', dischargeDate: null, dischargeInfo: null, roundNotes: [],
            history: { cc: '', hpi: '', ros: {}, text: '' },
            exam: { general: '', appearance: [], vitals: {}, systemic: {}, systems: '' },
            investigations: [], plan: '', medsLog: [], vitalsLog: [], progress: []
        });
        await db.savePatient(p);
        $('readmitModal').style.display = 'none';
        app.toast(`Readmitted. Admission #${p.episodes.length + 1} is open.`);
        await loadPatient(p.id);
    }

    function renderPrevious() {
        const eps = currPat.episodes || [];
        if (!eps.length) {
            $('tab-previous').innerHTML = `<h3>Previous Admissions</h3><p class="text-muted">No previous admissions. This is the patient's first admission.</p>`;
            return;
        }
        const cards = eps.map((ep, idx) => ({ ep, idx })).reverse().map(({ ep, idx }) => {
            const hist = historyLines(ep);
            const exam = examLines(ep).filter(l => !l.startsWith('Vitals:'));
            const inv = ep.investigations.map((i, k) => `
                <tr><td>${esc(fmtD(i.date))}</td><td>${esc(i.name)}</td><td>${esc(i.status)}</td><td>${esc(i.result) || '-'}</td>
                <td>${i.fileData ? `<button class="btn btn-sm btn-outline" onclick="clinical.viewImage(${k}, ${idx})">View</button>` : '-'}</td></tr>`).join('');
            const meds = ep.medsLog.map(m => `<li>${esc(m.name)} ${esc(m.dose)} ${esc(m.route)} ${esc(m.freq)}${m.times ? ' at ' + esc(m.times) : ''} ${esc(m.dur)}</li>`).join('');
            const dc = ep.dischargeInfo;
            return `
            <details class="episode-card" ${idx === eps.length - 1 ? 'open' : ''}>
                <summary>
                    <strong>Admission #${idx + 1}</strong>
                    <span>${esc(fmtD(ep.admissionDate))} &rarr; ${esc(fmtD(ep.dischargeDate))}</span>
                    <span class="ep-dx">${esc(ep.diagnosis)}</span>
                    <span class="text-muted">${esc(ep.doctor)}</span>
                </summary>
                <div class="summary-grid episode-body">
                    <div class="summary-block wide"><h4>Chief Complaint &amp; History</h4><p class="pre">${hist.length ? esc(hist.join('\n')) : '<span class="text-muted">Not documented.</span>'}</p></div>
                    <div class="summary-block wide"><h4>Examination</h4><p class="pre">${exam.length ? esc(exam.join('\n')) : '<span class="text-muted">Not documented.</span>'}</p></div>
                    <div class="summary-block wide"><h4>Investigations</h4>
                        ${inv ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Test</th><th>Status</th><th>Result</th><th>File</th></tr></thead><tbody>${inv}</tbody></table></div>` : '<p class="text-muted">None recorded.</p>'}</div>
                    <div class="summary-block wide"><h4>Management Plan</h4><p class="pre">${esc(ep.plan) || '<span class="text-muted">Not documented.</span>'}</p>
                        ${meds ? `<h4 style="margin-top:0.8rem">Medication orders</h4><ul class="plain-list">${meds}</ul>` : ''}</div>
                    <div class="summary-block wide"><h4>Discharge</h4>
                        ${dc ? `<p><strong>Destination:</strong> ${esc(dc.destination)}</p><p><strong>Condition:</strong> ${esc(dc.condition)}</p><p><strong>Diagnosis at discharge:</strong> ${esc(dc.diagnosis)}</p>`
                             : '<p class="text-muted">No discharge details recorded.</p>'}</div>
                </div>
            </details>`;
        }).join('');
        $('tab-previous').innerHTML = `
            <div class="section-head"><h3>Previous Admissions</h3><span class="text-muted">${eps.length} earlier admission${eps.length > 1 ? 's' : ''} &middot; read-only</span></div>
            ${cards}`;
    }

    return {
        openReadmit, executeReadmit,
        loadPatient, openTab, toggleSym, toggleAppearance, setSystemStatus, saveHistoryExam,
        savePMH, viewImage, galleryStep, closeViewer, logVitals, editMed, cancelEdit, addInv, delInv, savePlan, addMed, delMed, addNote,
        getPat: () => currPat,
        refreshOpenRecord: () => { if (currPat) { renderInvestigations(); renderOverview(); } },
        isDirty: () => dirty,
        setDirty,
        historyLines, examLines, rosLines,
        renderDischargeTab
    };
})();
