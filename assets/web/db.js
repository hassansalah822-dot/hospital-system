/* ---------- Shared constants & helpers (loaded first) ---------- */

// Full review-of-systems frame. Each symptom is a tri-state button:
// 0 = not asked, 1 = positive, 2 = negative.
const ROS_SYSTEMS = {
    'Constitutional': ['Fever', 'Chills / rigors', 'Night sweats', 'Weight loss', 'Loss of appetite', 'Fatigue'],
    'Respiratory': ['Cough', 'Sputum', 'Haemoptysis', 'Shortness of breath', 'Wheeze', 'Pleuritic chest pain'],
    'Cardiovascular': ['Chest pain', 'Palpitations', 'Orthopnoea', 'PND', 'Leg swelling', 'Syncope'],
    'Gastrointestinal': ['Nausea', 'Vomiting', 'Abdominal pain', 'Diarrhoea', 'Constipation', 'Melaena', 'Haematemesis', 'Jaundice'],
    'Genitourinary': ['Dysuria', 'Urinary frequency', 'Haematuria', 'Urinary retention', 'Oliguria', 'Loin pain'],
    'Neurological': ['Headache', 'Dizziness', 'Weakness', 'Seizures', 'Numbness', 'Visual disturbance', 'Confusion'],
    'Musculoskeletal': ['Joint pain', 'Joint swelling', 'Back pain', 'Muscle pain'],
    'Skin': ['Rash', 'Itching', 'Wounds / ulcers', 'Easy bruising'],
    'Endocrine': ['Polyuria', 'Polydipsia', 'Heat intolerance', 'Cold intolerance'],
    'Haematological': ['Bleeding gums', 'Lymph node swelling', 'Pallor'],
    'Psychiatric': ['Low mood', 'Anxiety', 'Sleep disturbance', 'Hallucinations'],
    'ENT / Eyes': ['Ear pain', 'Hearing loss', 'Sore throat', 'Eye pain', 'Blurred vision']
};

// Systems examined with a Normal / Abnormal choice plus notes.
const EXAM_SYSTEMS = [
    'Cardiovascular', 'Respiratory', 'Abdomen', 'Neurological',
    'Musculoskeletal', 'Lymphatic', 'Skin', 'ENT / Eyes', 'Genitourinary'
];

// General appearance findings (multi-select buttons).
const APPEARANCE_FINDINGS = [
    'Alert & oriented', 'Distressed', 'Ill-looking', 'Pale', 'Jaundiced',
    'Cyanosed', 'Dehydrated', 'Febrile', 'Pallid', 'Obtunded'
];

// Escape untrusted text before it is placed into HTML.
function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Save a generated file (PDF or JSON backup). Inside the Flutter app the file is
// handed to native code (saved to the phone); in a normal browser it downloads.
async function saveFileToDevice(name, blob) {
    blob = await blob;   // PDFs are built asynchronously
    if (window.HisSave && window.HisSave.postMessage) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                window.HisSave.postMessage(JSON.stringify({ name, dataUrl: reader.result }));
                resolve();
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Promise.resolve();
}

// Bring any stored record (including older versions) up to the current shape.
function normalizePatient(p) {
    if (!p) return p;
    p.history = Object.assign({ cc: '', hpi: '', ros: {}, text: '' }, p.history || {});
    p.history.ros = p.history.ros || {};

    // Legacy format stored flat "pos" / "neg" symptom arrays.
    if (Array.isArray(p.history.pos) || Array.isArray(p.history.neg)) {
        const mapLegacy = (list, state) => (list || []).forEach(sym => {
            for (const [sys, syms] of Object.entries(ROS_SYSTEMS)) {
                if (syms.includes(sym)) {
                    p.history.ros[sys] = p.history.ros[sys] || {};
                    p.history.ros[sys][sym] = state;
                }
            }
        });
        mapLegacy(p.history.pos, 1);
        mapLegacy(p.history.neg, 2);
        delete p.history.pos;
        delete p.history.neg;
    }

    p.exam = Object.assign({ general: '', appearance: [], vitals: {}, systemic: {}, systems: '' }, p.exam || {});
    p.exam.vitals = p.exam.vitals || {};
    p.exam.systemic = p.exam.systemic || {};
    p.exam.appearance = p.exam.appearance || [];

    p.pmh = p.pmh || [];
    p.drugs = p.drugs || [];
    p.social = p.social || '';
    p.investigations = p.investigations || [];
    if (!Array.isArray(p.roundNotes)) {
        // Older records kept one sticky note; move it into the list of dated notes.
        p.roundNotes = p.roundNote
            ? [{ id: 'legacy', text: p.roundNote, at: p.roundNoteAt || p.admissionDate || new Date().toISOString() }]
            : [];
    }
    p.progress = p.progress || [];
    p.medsLog = (p.medsLog || []).map(m => Object.assign({ name: '', dose: '', route: '', freq: '', times: '', dur: '' }, m));
    p.vitalsLog = p.vitalsLog || [];
    p.plan = p.plan || '';
    p.roundNote = p.roundNote || '';
    p.chronicIllness = p.chronicIllness || '';
    p.allergyStatus = p.allergyStatus || 'Unknown';
    p.allergyDetails = p.allergyDetails || '';
    p.status = p.status || 'active';
    p.episodes = p.episodes || [];     // previous admissions (oldest first)
    return p;
}

const db = (function() {
    let dbInstance = null;
    const DB_NAME = 'AldamanHIS_DB';
    const DB_VERSION = 2;

    function init() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB is not available in this browser.'));
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('patients')) database.createObjectStore('patients', { keyPath: 'id' });
                if (!database.objectStoreNames.contains('audit')) database.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
                if (!database.objectStoreNames.contains('attachments')) database.createObjectStore('attachments', { keyPath: 'fileId' });
                if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
            };
            req.onsuccess = (e) => { dbInstance = e.target.result; resolve(); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    function executeTx(storeName, mode, action) {
        return new Promise((resolve, reject) => {
            const tx = dbInstance.transaction(storeName, mode);
            const req = action(tx.objectStore(storeName));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    return {
        init,
        getPatient: async (id) => normalizePatient(await executeTx('patients', 'readonly', (s) => s.get(id))),
        getAllPatients: async () => (await executeTx('patients', 'readonly', (s) => s.getAll())).map(normalizePatient),
        savePatient: async (pat) => { await executeTx('patients', 'readwrite', (s) => s.put(pat)); },
        deletePatient: (id) => executeTx('patients', 'readwrite', (s) => s.delete(id)),
        getSetting: (key) => executeTx('settings', 'readonly', (s) => s.get(key)),
        saveSetting: (key, val) => executeTx('settings', 'readwrite', (s) => s.put({ key, value: val }))
    };
})();
