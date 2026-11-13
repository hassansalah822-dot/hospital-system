const app = (function() {
    const DEFAULT_DOCTORS = ['Dr. Omima', 'Dr. Osama', 'Dr. Omer'];
    const TITLES = {
        'dashboard': 'Dashboard', 'active-patients': 'Active Ward List', 'add-patient': 'Admit Patient',
        'search': 'Global Search', 'archive': 'Patient Archive', 'settings': 'Settings & Configuration',
        'backup': 'Backup & Restore', 'ward-round': 'Ward Round'
    };
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
    }

    function setTitle(text) { $('topbar-title').textContent = text; }

    /* ---------- Dashboard & ward round ---------- */

    async function loadDashboard() {
        const patients = await db.getAllPatients();
        const active = patients.filter(p => p.status === 'active');
        const today = new Date().toDateString();
        const pendingLabs = active.reduce((n, p) => n + p.investigations.filter(i => i.status === 'Requested').length, 0);

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
                    <div><strong>Round sticky notes &middot; ${todayLabel()}</strong>
                        <div class="round-notes">${roundNotesHtml(p)}</div>
                        <textarea id="rn-${esc(p.id)}" class="form-control" rows="2" placeholder="Write a new note..."></textarea>
                        <div class="form-actions"><button class="btn btn-primary btn-sm" onclick="app.addRoundNote('${esc(p.id)}')">Add note</button></div></div>
                </div>
            </div>`;
        }).join('') : `<p class="text-muted">No active patients under ${esc(docName)}.</p>`;
        navigate('ward-round');
    }

    function roundNotesHtml(p) {
        const notes = p.roundNotes || [];
        if (!notes.length) return '<p class="text-muted">No notes yet.</p>';
        return notes.map(n => `
            <div class="round-note">
                <small class="text-muted">${esc(new Date(n.at).toLocaleString())}</small>
                <p style="white-space:pre-wrap;margin:0.2rem 0 0.6rem">${esc(n.text)}</p>
            </div>`).join('');
    }

    async function addRoundNote(id) {
        const text = $('rn-' + id).value.trim();
        if (!text) { alert('Write the note first.'); return; }
        const pat = await db.getPatient(id);
        if (!pat) return;
        pat.roundNotes = pat.roundNotes || [];
        pat.roundNotes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, at: new Date().toISOString() });
        await db.savePatient(pat);
        // Keep an open record in step so a later save cannot drop the new note.
        const open = clinical.getPat();
        if (open && open.id === id) { open.roundNotes = pat.roundNotes; clinical.refreshOpenRecord(); }
        toast('Note added');
        startWardRound(pat.doctor);
    }

    function todayLabel() {
        return new Date().toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    }

    /* ---------- Pending investigations ---------- */

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async function openPendingLabs() {
        await renderPendingLabs();
        $('pendingLabsModal').style.display = 'flex';
    }

    function closePendingLabs() {
        $('pendingLabsModal').style.display = 'none';
        loadDashboard();
    }

    async function renderPendingLabs() {
        const active = (await db.getAllPatients()).filter(p => p.status === 'active');
        const items = [];
        active.forEach(p => (p.investigations || []).forEach((inv, idx) => {
            if (inv.status === 'Requested') items.push({ p, idx, inv });
        }));
        $('pendingLabsList').innerHTML = items.length ? items.map(({ p, idx, inv }) => `
            <div class="card pending-lab" data-pid="${esc(p.id)}" data-idx="${idx}">
                <div class="pending-lab-head">
                    <strong>${esc(p.name)}</strong> <small class="text-muted">(${esc(p.id)}) &middot; ${esc(p.location || '')}</small><br>
                    <span>${esc(inv.name)}</span> <small class="text-muted">requested ${esc(inv.date)}</small>
                </div>
                <div class="form-group">
                    <label>Result / note <small>(optional)</small></label>
                    <input type="text" class="form-control pl-result" placeholder="Key result">
                </div>
                <div class="pending-lab-actions">
                    <label class="btn btn-outline btn-sm">Take photo
                        <input type="file" accept="image/*" capture="environment" class="pl-file" hidden onchange="app.pendingFileChosen(this)">
                    </label>
                    <label class="btn btn-outline btn-sm">Upload
                        <input type="file" accept="image/*" class="pl-file" hidden onchange="app.pendingFileChosen(this)">
                    </label>
                    <span class="pl-chosen text-muted"></span>
                    <button class="btn btn-primary btn-sm pl-ok" onclick="app.completePendingLab(this)">OK</button>
                </div>
            </div>`).join('') : '<p class="text-muted">No pending investigations.</p>';
    }

    function pendingFileChosen(input) {
        const row = input.closest('.pending-lab');
        // Only one picture per test: choosing one clears the other.
        row.querySelectorAll('.pl-file').forEach(f => { if (f !== input) f.value = ''; });
        row.querySelector('.pl-chosen').textContent = input.files[0] ? input.files[0].name : '';
    }

    async function completePendingLab(btn) {
        const row = btn.closest('.pending-lab');
        const id = row.dataset.pid;
        const idx = Number(row.dataset.idx);
        const result = row.querySelector('.pl-result').value.trim();
        const file = [...row.querySelectorAll('.pl-file')].map(f => f.files[0]).find(Boolean);

        if (!result && !file) { alert('Attach a picture or type the result before pressing OK.'); return; }
        if (file && file.size > 4 * 1024 * 1024) { alert('Please attach an image smaller than 4 MB.'); return; }

        btn.disabled = true;
        try {
            const pat = await db.getPatient(id);
            const inv = pat && pat.investigations[idx];
            if (!inv || inv.status !== 'Requested') {
                app.toast('This test was already updated');
                await renderPendingLabs();
                return;
            }
            inv.status = 'Completed';
            inv.result = result;
            inv.completedDate = new Date().toISOString().split('T')[0];
            if (file) inv.fileData = await readAsDataURL(file);
            await db.savePatient(pat);

            // If this patient's record is open, keep it in step so a later save cannot undo this.
            const open = clinical.getPat();
            if (open && open.id === id && open.investigations[idx]) {
                open.investigations[idx] = inv;
                clinical.refreshOpenRecord();
            }
            toast('Result added to ' + pat.name + ' - ' + inv.name);
            await renderPendingLabs();
        } catch (e) {
            alert('Could not save the result: ' + e.message);
        } finally {
            btn.disabled = false;
        }
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

    return {
        init: bootstrap, getConfig, setTitle, toast, verifyPin, lockSystem, navigate,
        loadDashboard, startWardRound, addRoundNote, toggleAllergy, handleAdmission,
        openPendingLabs, closePendingLabs, pendingFileChosen, completePendingLab,
        loadActivePatients, performSearch, saveSystemSettings, addDoctor, removeDoctor,
        resetDashboardLayout: loadDashboard
    };
})();

document.addEventListener('DOMContentLoaded', () => {
    app.init();
    const pinEl = document.getElementById('pinInput');
    pinEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.verifyPin(); });
    pinEl.focus();
});
