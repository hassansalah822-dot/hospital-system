const app = (function() {
    const DEFAULT_DOCTORS = ['Dr. Omima', 'Dr. Osama', 'Dr. Omer'];
    const TITLES = {
        'dashboard': 'Dashboard', 'active-patients': 'Active Ward List', 'add-patient': 'Admit Patient',
        'search': 'Global Search', 'archive': 'Patient Archive', 'settings': 'Settings & Configuration',
        'backup': 'Backup & Restore', 'ward-round': 'Ward Round', 'pending': 'Pending Investigations'
    };
    const pendingDraft = {};   // picture/result typed on the Pending page, keyed by patientId|index
    const $ = (id) => document.getElementById(id);

    let config = {
        hospitalName: 'Merowe Medical City',
        appTitle: 'Clinical Documentation System',
        tagline: 'Patient Care • Clinical Documentation',
        address: '',
        phone: '',
        pin: '1234',
        logoData: ''              // empty = use the built-in hospital logo
    };
    let currentScreen = 'dashboard';

    /* ---------- Settings & bootstrap ---------- */

    async function setting(key, fallback) {
        const row = await db.getSetting(key);
        return row && row.value !== undefined && row.value !== null ? row.value : fallback;
    }

    async function bootstrap() {
        try {
            await db.init();
        } catch (err) {
            document.body.innerHTML = `<div style="padding:2rem;font-family:sans-serif"><h2>Storage unavailable</h2><p>This system needs browser database storage (IndexedDB). Please open it in a current browser and disable private/incognito mode.</p></div>`;
            return;
        }
        config.hospitalName = await setting('hospitalName', config.hospitalName);
        config.appTitle = await setting('appTitle', config.appTitle);
        config.tagline = await setting('tagline', config.tagline);
        config.address = await setting('address', config.address);
        config.phone = await setting('phone', config.phone);
        config.pin = await setting('pin', config.pin);
        config.logoData = await setting('hospitalLogo', '');
        if (!(await db.getSetting('doctors'))) await db.saveSetting('doctors', DEFAULT_DOCTORS);
        applyIdentity();
        await populateDoctorDropdowns();
    }

    function applyIdentity() {
        const logo = config.logoData || DEFAULT_LOGO_DATA;
        document.title = `${config.hospitalName} - ${config.appTitle}`;
        $('authHospitalName').textContent = config.hospitalName;
        $('authAppTitle').textContent = config.appTitle;
        $('sidebarAppName').textContent = config.appTitle;
        $('authLogo').src = logo;
        $('sidebarLogo').src = logo;
        $('setHospitalName').value = config.hospitalName;
        $('setAppTitle').value = config.appTitle;
        $('setTagline').value = config.tagline;
        $('setAddress').value = config.address;
        $('setPhone').value = config.phone;
        $('setLogoPreview').src = logo;
    }

    async function populateDoctorDropdowns() {
        const list = (await db.getSetting('doctors')).value;
        $('patDoctor').innerHTML = list.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        $('rdDoctor').innerHTML = $('patDoctor').innerHTML;
        $('doctorList').innerHTML = list.map((d, i) => `
            <li><span>${esc(d)}</span>
            <button class="btn btn-sm btn-danger" onclick="app.removeDoctor(${i})">Remove</button></li>`).join('') || '<li class="text-muted">No doctors configured.</li>';
    }

    function toast(message) {
        const el = $('toast');
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove('show'), 2600);
    }

    /* ---------- Authentication ---------- */

    function verifyPin() {
        if ($('pinInput').value === config.pin) {
            $('pinError').style.display = 'none';
            $('pinInput').value = '';
            $('auth-screen').style.display = 'none';
            $('app-container').style.display = 'flex';
            navigate('dashboard');
        } else {
            $('pinError').style.display = 'block';
            $('pinInput').select();
        }
    }

    function lockSystem() {
        $('pinInput').value = '';
        $('auth-screen').style.display = 'flex';
        $('app-container').style.display = 'none';
        $('pinInput').focus();
    }

    /* ---------- Navigation ---------- */

    function navigate(screenId) {
        if (screenId !== currentScreen && currentScreen === 'patient-record' && clinical.isDirty()
            && !confirm('You have unsaved history / examination changes. Leave without saving?')) return;
        currentScreen = screenId;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        $(screenId).classList.add('active');
        const nav = document.querySelector(`.nav-item[onclick="app.navigate('${screenId}')"]`);
        if (nav) nav.classList.add('active');
        $('sidebar').classList.remove('open');
        setTitle(TITLES[screenId] || config.appTitle);
        document.querySelector('.main-content').scrollTop = 0;

        if (screenId === 'dashboard') loadDashboard();
        if (screenId === 'active-patients') loadActivePatients();
        if (screenId === 'archive') docs.loadArchive();
        if (screenId === 'settings') populateDoctorDropdowns();
        if (screenId === 'pending') loadPending();
    }

    function setTitle(text) { $('topbar-title').textContent = text; }

    /* ---------- Dashboard & ward round ---------- */

    async function loadDashboard() {
        const patients = await db.getAllPatients();
        const active = patients.filter(p => p.status === 'active');
        const today = new Date().toDateString();
        const pendingLabs = patients.reduce((n, p) => n + (p.investigations || []).filter(i => i.status === 'Requested').length, 0);

        $('dash-active').textContent = active.length;
        $('dash-today').textContent = active.filter(p => new Date(p.admissionDate).toDateString() === today).length;
        $('dash-alerts').textContent = active.filter(p => p.allergyStatus === 'Allergies Present' || p.chronicIllness).length;
        $('dash-labs').textContent = pendingLabs;

        const list = (await db.getSetting('doctors')).value;
        $('doctorRoundButtons').innerHTML = list.map(d =>
            `<button class="btn btn-round" onclick="app.startWardRound('${esc(d)}')">Start Round: ${esc(d)}</button>`).join('');

        const recent = active.sort((a, b) => new Date(b.admissionDate) - new Date(a.admissionDate)).slice(0, 8);
        $('recentActivityTable').querySelector('tbody').innerHTML = recent.map(p => `
            <tr class="clickable" onclick="clinical.loadPatient('${esc(p.id)}')">
                <td>${new Date(p.admissionDate).toLocaleDateString()}</td>
                <td>${esc(p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.diagnosis)}</td><td>${esc(p.doctor)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="text-muted">No active patients.</td></tr>';
    }

    async function startWardRound(docName) {
        $('wardRoundTitle').textContent = `Ward Round: ${docName}`;
        const mine = (await db.getAllPatients()).filter(p => p.status === 'active' && p.doctor === docName);
        $('wardRoundList').innerHTML = mine.length ? mine.map(p => {
            const tags = [];
            if (p.chronicIllness) tags.push(`<span class="tag tag-blue">Chronic: ${esc(p.chronicIllness)}</span>`);
            if (p.allergyStatus === 'Allergies Present') tags.push(`<span class="tag tag-red">Allergy: ${esc(p.allergyDetails)}</span>`);
            else tags.push(`<span class="tag tag-amber">${esc(p.allergyStatus)}</span>`);
            const orders = p.medsLog.map(m => `• ${m.name} ${m.dose} ${m.route} ${m.freq}${m.times ? ' at ' + m.times : ''}${m.dur ? ' for ' + m.dur : ''}`);
            const planText = [p.plan || 'No plan documented.', orders.length ? 'Medication orders:\n' + orders.join('\n') : ''].filter(Boolean).join('\n\n');
            return `
            <div class="card round-card">
                <div class="round-head">
                    <div>
                        <h3>${esc(p.name)} <small>(${esc(p.id)})</small></h3>
                        <p class="text-muted">${esc(p.age)} yrs ${esc(p.sex)} &middot; ${esc(p.location)} &middot; Admitted ${new Date(p.admissionDate).toLocaleDateString()}</p>
                        <p><strong>Diagnosis:</strong> ${esc(p.diagnosis)}</p>
                        <div>${tags.join(' ')}</div>
                    </div>
                    <button class="btn btn-primary" onclick="clinical.loadPatient('${esc(p.id)}')">Open Record</button>
                </div>
                <div class="round-body">
                    <div><strong>Active plan</strong>
                        <p class="pre muted-box">${esc(planText)}</p></div>
                    <div><strong>Round notes</strong>
                        ${(p.roundNotes || []).length ? p.roundNotes.slice().reverse().map(n => `
                            <div class="note-card"><small class="text-muted">${new Date(n.date).toLocaleString()}</small>
                            <p class="note-text">${esc(n.text)}</p></div>`).join('') : '<p class="text-muted">No round notes yet.</p>'}
                        <textarea class="form-control" id="rn-${esc(p.id)}" rows="2" placeholder="Note from this round..."></textarea>
                        <button class="btn btn-outline btn-sm" onclick="app.addRoundNote('${esc(p.id)}')">Save note (date &amp; time)</button></div>
                </div>
            </div>`;
        }).join('') : `<p class="text-muted">No active patients under ${esc(docName)}.</p>`;
        navigate('ward-round');
    }

    // Each round note is a new, dated entry. Press the button again for another note.
    async function addRoundNote(id) {
        const box = $('rn-' + id);
        const text = box ? box.value.trim() : '';
        if (!text) { alert('Write the note first.'); return; }
        const pat = await db.getPatient(id);
        if (!pat) return;
        pat.roundNotes = pat.roundNotes || [];
        pat.roundNotes.push({ date: new Date().toISOString(), text });
        await db.savePatient(pat);
        clinical.syncRoundNotes(id, pat.roundNotes);
        toast('Round note saved');
        startWardRound(pat.doctor);
    }

    /* ---------- Pending investigations ---------- */

    async function loadPending() {
        const all = await db.getAllPatients();
        const items = [];
        all.forEach(p => (p.investigations || []).forEach((inv, idx) => {
            if (inv.status === 'Requested') items.push({ p, inv, idx });
        }));
        $('pendingCount').textContent = `${items.length} pending investigation${items.length === 1 ? '' : 's'}`;
        $('pendingList').innerHTML = items.map(({ p, inv, idx }) => {
            const d = pendingDraft[p.id + '|' + idx] || {};
            return `
            <div class="card pending-card" data-pid="${esc(p.id)}" data-idx="${idx}">
                <div class="pending-head">
                    <div><h3>${esc(inv.name)}</h3>
                    <p class="text-muted">${esc(p.name)} &middot; ${esc(p.id)} &middot; Requested ${esc(inv.date || '')} &middot; ${esc(p.doctor)}</p></div>
                    <button class="btn btn-outline btn-sm" onclick="clinical.loadPatient('${esc(p.id)}')">Open record</button>
                </div>
                <div class="pending-body">
                    <div class="attach-btns">
                        <label class="btn btn-outline btn-sm">Choose picture<input type="file" accept="image/*" hidden data-pend="file"></label>
                        <label class="btn btn-outline btn-sm">Take photo<input type="file" accept="image/*" capture="environment" hidden data-pend="file"></label>
                    </div>
                    <small class="text-muted">${d.fileName ? 'Picture ready: ' + esc(d.fileName) : 'No picture yet.'}</small>
                    <div class="form-group"><label>Result</label>
                        <input type="text" class="form-control" data-pend="result" value="${esc(d.result || '')}" placeholder="Key result"></div>
                    <button class="btn btn-primary" data-pend="done">Done</button>
                </div>
            </div>`;
        }).join('') || '<p class="text-muted">No pending investigations. Requested tests appear here.</p>';
    }

    // Done: the result and/or picture is written into the patient file and the item leaves pending.
    async function donePending(pid, idx) {
        const key = pid + '|' + idx;
        const pat = await db.getPatient(pid);
        const inv = pat && pat.investigations[idx];
        if (!inv || inv.status !== 'Requested') { toast('This item is no longer pending.'); return loadPending(); }
        const d = pendingDraft[key] || {};
        const result = (d.result || '').trim();
        if (!d.fileData && !result) { alert('Add a picture or a result before pressing Done.'); return; }
        inv.status = 'Completed';
        inv.completedDate = new Date().toISOString();
        if (result) inv.result = result;
        if (d.fileData) inv.fileData = d.fileData;
        await db.savePatient(pat);
        delete pendingDraft[key];
        await clinical.reloadIfOpen(pid);
        toast('Investigation added to the patient file');
        loadPending();
        loadDashboard();
    }


    /* ---------- Admission ---------- */

    function toggleAllergy() {
        $('allergyDetailsGroup').style.display = $('patAllergyStatus').value === 'Allergies Present' ? 'block' : 'none';
    }

    function newMRN() {
        const stamp = Date.now().toString(36).toUpperCase().slice(-5);
        const rand = Math.floor(Math.random() * 36 * 36).toString(36).toUpperCase().padStart(2, '0');
        return `MRN-${stamp}${rand}`;
    }

    async function handleAdmission(e) {
        e.preventDefault();
        const age = Number($('patAge').value);
        if (!Number.isFinite(age) || age < 0 || age > 130) { alert('Enter a valid age.'); return; }
        const allergyStatus = $('patAllergyStatus').value;
        const allergyDetails = $('patAllergyDetails').value.trim();
        if (allergyStatus === 'Allergies Present' && !allergyDetails) { alert('Specify the allergies.'); return; }

        const p = {
            id: newMRN(),
            name: $('patName').value.trim(),
            sex: $('patSex').value,
            age: String(age),
            location: $('patLocation').value.trim(),
            doctor: $('patDoctor').value,
            diagnosis: $('patDiagnosis').value.trim(),
            chronicIllness: $('patChronic').value.trim(),
            allergyStatus,
            allergyDetails: allergyStatus === 'Allergies Present' ? allergyDetails : '',
            admissionDate: new Date().toISOString(),
            status: 'active',
            history: { cc: '', hpi: '', ros: {}, text: '' },
            exam: { general: '', appearance: [], vitals: {}, systemic: {}, systems: '' },
            pmh: [], drugs: [], social: '', surgical: '',
            investigations: [], progress: [], plan: '', medsLog: [], vitalsLog: [], roundNotes: []
        };
        await db.savePatient(p);
        $('admissionForm').reset();
        toggleAllergy();
        toast(`Patient admitted. MRN ${p.id}`);
        clinical.loadPatient(p.id);
    }

    /* ---------- Lists & search ---------- */

    async function loadActivePatients() {
        const w = $('filterWard').value.trim().toLowerCase();
        const d = $('filterDoc').value.trim().toLowerCase();
        let pts = (await db.getAllPatients()).filter(p => p.status === 'active');
        if (w) pts = pts.filter(p => p.location.toLowerCase().includes(w));
        if (d) pts = pts.filter(p => p.doctor.toLowerCase().includes(d));

        $('activePatientsTable').querySelector('tbody').innerHTML = pts.map(p => {
            let alerts = '';
            if (p.chronicIllness) alerts += `<span class="tag tag-blue">Chronic</span> `;
            if (p.allergyStatus === 'Allergies Present') alerts += `<span class="tag tag-red">Allergy</span>`;
            else if (p.allergyStatus === 'Unknown') alerts += `<span class="tag tag-amber">Allergy unknown</span>`;
            return `<tr class="clickable" onclick="clinical.loadPatient('${esc(p.id)}')">
                <td>${esc(p.id)}</td><td><b>${esc(p.name)}</b><br><small class="text-muted">${esc(p.age)} yrs ${esc(p.sex)}</small></td>
                <td>${esc(p.location)}</td><td>${esc(p.diagnosis)}</td><td>${esc(p.doctor)}</td><td>${alerts}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="text-muted">No matching active patients.</td></tr>';
    }

    async function performSearch() {
        const q = $('globalSearchInput').value.trim().toLowerCase();
        const tbody = $('searchResults').querySelector('tbody');
        if (!q) { tbody.innerHTML = ''; return; }
        const res = (await db.getAllPatients()).filter(p =>
            p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.diagnosis.toLowerCase().includes(q));
        tbody.innerHTML = res.map(p => `
            <tr><td>${esc(p.id)}</td><td>${esc(p.name)}</td>
            <td><span class="tag ${p.status === 'active' ? 'tag-green' : 'tag-amber'}">${esc(p.status.toUpperCase())}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="clinical.loadPatient('${esc(p.id)}')">Open</button></td></tr>`).join('')
            || '<tr><td colspan="4" class="text-muted">No matches.</td></tr>';
    }

    /* ---------- Settings ---------- */

    function getConfig() { return config; }

    async function saveSystemSettings() {
        const hName = $('setHospitalName').value.trim();
        const aTitle = $('setAppTitle').value.trim();
        if (!hName) { alert('Hospital name is required.'); return; }

        config.hospitalName = hName;
        config.appTitle = aTitle || 'Clinical Documentation System';
        config.tagline = $('setTagline').value.trim();
        config.address = $('setAddress').value.trim();
        config.phone = $('setPhone').value.trim();

        const newPin = $('setPin').value.trim();
        if ($('setResetPin').checked) {
            config.pin = '1234';
            await db.saveSetting('pin', '1234');
            $('setResetPin').checked = false;
        } else if (newPin) {
            if (!/^\d{4}$/.test(newPin)) { alert('The PIN must be exactly 4 digits.'); return; }
            config.pin = newPin;
            await db.saveSetting('pin', newPin);
        }

        if ($('setResetLogo').checked) config.logoData = '';
        const file = $('setLogoFile').files[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) { alert('Please choose a logo smaller than 2 MB.'); return; }
            config.logoData = await readAsDataURL(file);
        }

        for (const k of ['hospitalName', 'appTitle', 'tagline', 'address', 'phone']) {
            await db.saveSetting(k, config[k]);
        }
        await db.saveSetting('hospitalLogo', config.logoData);
        $('setPin').value = '';
        $('setLogoFile').value = '';
        $('setResetLogo').checked = false;
        applyIdentity();
        toast('Hospital identity saved. Documents will use these details.');
    }

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
        });
    }

    async function addDoctor() {
        const input = $('newDocName');
        const name = input.value.trim();
        if (!name) return;
        const list = (await db.getSetting('doctors')).value;
        if (list.some(d => d.toLowerCase() === name.toLowerCase())) { alert('This doctor is already on the list.'); return; }
        list.push(name);
        await db.saveSetting('doctors', list);
        input.value = '';
        await populateDoctorDropdowns();
        toast('Doctor added');
    }

    async function removeDoctor(index) {
        const list = (await db.getSetting('doctors')).value;
        const name = list[index];
        if (!confirm(`Remove ${name} from the doctor list? Existing patient records keep their assigned doctor.`)) return;
        list.splice(index, 1);
        await db.saveSetting('doctors', list);
        await populateDoctorDropdowns();
    }

    // Wire the Pending page: picture pick, result typing and Done (runs once at start-up).
    function bindPending() {
        const pl = $('pendingList');
        const cardOf = (el) => el.closest('.pending-card');
        pl.addEventListener('input', (e) => {
            const card = cardOf(e.target);
            if (!card || e.target.dataset.pend !== 'result') return;
            const k = card.dataset.pid + '|' + card.dataset.idx;
            pendingDraft[k] = Object.assign(pendingDraft[k] || {}, { result: e.target.value });
        });
        pl.addEventListener('change', async (e) => {
            const card = cardOf(e.target);
            const file = e.target.files && e.target.files[0];
            if (!card || e.target.dataset.pend !== 'file' || !file) return;
            try {
                const fileData = await compressImage(file);
                const k = card.dataset.pid + '|' + card.dataset.idx;
                pendingDraft[k] = Object.assign(pendingDraft[k] || {}, { fileData, fileName: file.name || 'camera photo' });
                card.querySelector('.pending-body small').textContent = 'Picture ready: ' + (file.name || 'camera photo');
            } catch (err) { alert('That picture could not be read. Try another photo.'); }
            e.target.value = '';
        });
        pl.addEventListener('click', (e) => {
            const card = cardOf(e.target);
            if (!card || e.target.dataset.pend !== 'done') return;
            donePending(card.dataset.pid, Number(card.dataset.idx));
        });
    }

    return {
        init: bootstrap, getConfig, setTitle, toast, verifyPin, lockSystem, navigate,
        loadDashboard, startWardRound, addRoundNote, loadPending, donePending, bindPending, toggleAllergy, handleAdmission,
        loadActivePatients, performSearch, saveSystemSettings, addDoctor, removeDoctor,
        resetDashboardLayout: loadDashboard
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    app.bindPending();
    const pinEl = document.getElementById('pinInput');
    pinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.verifyPin(); });
    pinEl.focus();
});
