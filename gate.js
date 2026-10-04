// Access gate + Firebase backend for the scheduling board.
// Flow: Google sign-in → access/{uid} request (pending) → owner approves as viewer/editor → app loads.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, OWNER_EMAIL } from './firebase-config.js';

const ROLE_NAMES = { pending: 'ממתין לאישור', viewer: 'צפייה בלבד', editor: 'עריכה', denied: 'נדחה', owner: 'מנהל' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const ERRORS = {
  'auth/network-request-failed': 'אין חיבור לאינטרנט',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות',
  'auth/user-disabled': 'החשבון חסום',
  'auth/unauthorized-domain': 'הכתובת של האתר לא מאושרת להתחברות ב-Firebase',
  'auth/internal-error': 'שגיאה פנימית בהתחברות',
  'permission-denied': 'אין הרשאה',
  'unavailable': 'אין חיבור לשרת',
};
const errMsg = e => (e && ERRORS[e.code]) || 'שגיאה לא צפויה' + (e && e.code ? ` (${e.code})` : '');

// ---------- overlay ----------
const gate = document.createElement('div');
gate.className = 'gate'; gate.dir = 'rtl'; gate.lang = 'he';
document.body.appendChild(gate);
function screen(html) { gate.hidden = false; gate.innerHTML = `<div class="gate-card"><h1>לוח שיבוץ פלוגתי</h1>${html}</div>`; }
function hideGate() { gate.hidden = true; gate.innerHTML = ''; }
function gtoast(msg) { const el = $('#toast'); if (!el) return alert(msg); el.textContent = msg; el.hidden = false; clearTimeout(gtoast._t); gtoast._t = setTimeout(() => el.hidden = true, 2600); }

if (String(firebaseConfig.apiKey).includes('REPLACE_ME') || OWNER_EMAIL.includes('OWNER_EMAIL')) {
  screen(`<p>האתר עוד לא הוגדר. יש למלא את <code>firebase-config.js</code> לפי ההוראות ב-README.</p>`);
  throw new Error('firebase-config.js is not filled in');
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'he'; // Google sign-in screens in Hebrew
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const inAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)|Telegram/i.test(navigator.userAgent);
const isOwner = u => !!u && !!u.email && u.emailVerified && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase();

let me = null, role = null, started = false, unsubMine = null;

// ---------- backend adapters (same shape the app used before) ----------
function mapErr(e) {
  if (e && e.code === 'permission-denied') { const x = new Error('אין הרשאת כתיבה'); x.code = 'invalid_argument'; throw x; }
  throw e;
}
const dbApi = {
  doc(path) {
    const ref = doc(fs, path);
    return {
      set: data => setDoc(ref, data).catch(mapErr),
      // The app's update() is a deep merge of nested maps — Firestore's merge-set does exactly that.
      update: data => setDoc(ref, data, { merge: true }).catch(mapErr),
      onSnapshot: (cb, err) => onSnapshot(ref, s => cb({ exists: s.exists(), data: () => s.data() }), err),
    };
  },
};
const userApi = {
  id: async () => me.uid,
  can: async perm => perm === 'data.write' ? (role === 'editor' || role === 'owner') : null,
  profiles: async ids => {
    const out = {};
    await Promise.all(ids.map(async id => { try { const s = await getDoc(doc(fs, 'profiles', id)); if (s.exists()) out[id] = { name: s.data().name || '' }; } catch (e) {} }));
    return out;
  },
};
const downloadsApi = {
  save: async ({ filename, data }) => {
    const type = filename.endsWith('.csv') ? 'text/csv;charset=utf-8' : filename.endsWith('.json') ? 'application/json' : 'text/html;charset=utf-8';
    const bom = filename.endsWith('.csv') && !String(data).startsWith('\ufeff') ? '\ufeff' : ''; // Excel needs a BOM to read Hebrew
    const blob = new Blob([bom + data], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
};

function start() {
  if (started) return;
  started = true; hideGate(); renderAcct();
  setDoc(doc(fs, 'profiles', me.uid), { name: me.displayName || me.email }).catch(() => {});
  window.__gate.resolve({ db: dbApi, user: userApi, downloads: downloadsApi });
}

// ---------- sign-in ----------
async function signIn() {
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return signInWithRedirect(auth, provider);
    if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') gtoast('ההתחברות נכשלה: ' + errMsg(e));
  }
}
getRedirectResult(auth).catch(() => {});

function signedOutScreen() {
  screen(`<p>הכלי סגור. כדי לקבל גישה לחצו על הכפתור, התחברו עם חשבון Google, ומנהל הכלי יאשר אתכם.</p>
    <button class="gbtn primary" data-g="request">בקשת גישה</button>
    <p class="gmuted">כבר אושרתם? אותו כפתור מכניס אתכם. אחרי הכניסה הראשונה הדפדפן זוכר אתכם.</p>
    ${inAppBrowser ? `<p class="gwarn">נראה שהקישור נפתח בתוך אפליקציה (וואטסאפ וכד'). Google לא מאפשרת התחברות שם — פתחו את הקישור ב-Chrome או ב-Safari (⋮ ← "פתח בדפדפן").</p>` : ''}`);
}

onAuthStateChanged(auth, async user => {
  if (unsubMine) { unsubMine(); unsubMine = null; }
  if (!user) { if (started) return location.reload(); me = null; role = null; return signedOutScreen(); }
  me = user;
  if (isOwner(user)) { role = 'owner'; return start(); }
  screen(`<p>בודק הרשאה…</p>`);
  const ref = doc(fs, 'access', user.uid);
  unsubMine = onSnapshot(ref, async snap => {
    const r = snap.exists() ? snap.data().role : null;
    if (started && r !== role) return location.reload(); // role changed or revoked while open
    role = r;
    if (r === 'viewer' || r === 'editor') return start();
    if (!snap.exists()) {
      // First visit: the single "request access" click both signs in and files the request.
      try { await setDoc(ref, { email: user.email, name: user.displayName || '', role: 'pending', requestedAt: serverTimestamp() }); }
      catch (e) { screen(`<p>שליחת הבקשה נכשלה: ${esc(errMsg(e))}.</p><button class="gbtn" data-g="out">יציאה</button>`); }
      return;
    }
    const who = `<p class="gmuted">מחובר/ת כ-<bdi>${esc(user.email)}</bdi></p>`;
    if (r === 'pending') screen(`<p><b>הבקשה נשלחה.</b> ברגע שמנהל הכלי יאשר, הלוח ייפתח כאן אוטומטית — אין צורך לרענן.</p>${who}<button class="gbtn" data-g="out">התחברות בחשבון אחר</button>`);
    else screen(`<p>הבקשה לא אושרה. אם זו טעות, פנו למנהל הכלי.</p>${who}<button class="gbtn" data-g="out">התחברות בחשבון אחר</button>`);
  }, e => screen(`<p>לא ניתן לבדוק הרשאה: ${esc(errMsg(e))}.</p><button class="gbtn" data-g="out">יציאה</button>`));
});

// ---------- account chip + admin panel ----------
let unsubReq = null, requests = [];
function renderAcct() {
  const el = $('#acct'); if (!el || !me) return;
  const pend = requests.filter(r => r.role === 'pending').length;
  el.innerHTML = `<span class="acct-who" title="${esc(me.email)}"><bdi>${esc(me.displayName || me.email)}</bdi> · ${ROLE_NAMES[role] || ''}</span>
    ${role === 'owner' ? `<button class="btn sm" data-g="admin">הרשאות${pend ? ` <span class="gbadge">${pend}</span>` : ''}</button>` : ''}
    <button class="btn sm" data-g="out">יציאה</button>`;
  if (role === 'owner' && !unsubReq) {
    unsubReq = onSnapshot(collection(fs, 'access'), qs => {
      requests = qs.docs.map(d => Object.assign({ uid: d.id }, d.data())).sort((a, b) => (a.role === 'pending' ? 0 : 1) - (b.role === 'pending' ? 0 : 1) || String(a.email).localeCompare(String(b.email)));
      renderAcct(); if ($('#admin')) renderAdmin();
    }, e => console.error(e));
  }
}
function renderAdmin() {
  const fmt = t => t && t.toDate ? t.toDate().toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const rows = requests.map(r => `<tr><td><div class="pname">${esc(r.name || '—')}</div><div class="psub ltr">${esc(r.email)}</div></td>
    <td>${r.role === 'pending' ? `<span class="tag ev">${ROLE_NAMES.pending}</span><div class="psub">${fmt(r.requestedAt)}</div>` : `<span class="tag ${r.role === 'editor' ? 'sb' : r.role === 'viewer' ? 'rc' : 'off'}">${ROLE_NAMES[r.role] || r.role}</span>`}</td>
    <td><div class="row">
      ${r.role !== 'editor' ? `<button class="btn sm primary" data-role="editor" data-uid="${r.uid}">אשר לעריכה</button>` : ''}
      ${r.role !== 'viewer' ? `<button class="btn sm${r.role === 'pending' ? ' primary' : ''}" data-role="viewer" data-uid="${r.uid}">אשר לצפייה</button>` : ''}
      ${r.role !== 'denied' ? `<button class="btn sm danger" data-role="denied" data-uid="${r.uid}">${r.role === 'pending' ? 'דחה' : 'בטל גישה'}</button>` : ''}
      <button class="btn sm" data-delreq="${r.uid}" title="מחיקת הרשומה מאפשרת לו לבקש שוב">מחק</button>
    </div></td></tr>`).join('');
  const m = $('#admin');
  m.innerHTML = `<div class="scrim" data-g="closeAdmin"><div class="dialog" style="width:min(760px,100%)" role="dialog" aria-label="ניהול הרשאות">
    <header><div><h2>ניהול הרשאות</h2><div class="muted" style="font-size:.85rem">מי שמקבל את הקישור לוחץ "בקשת גישה" ומופיע כאן.</div></div><button class="btn sm" data-g="closeAdmin">סגור</button></header>
    <div class="body">
      <div class="row"><button class="btn" data-g="copyLink">העתק קישור לשיתוף</button></div>
      ${requests.length ? `<div class="gridwrap"><table class="tbl" style="min-width:560px"><thead><tr><th>משתמש</th><th>מצב</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">עדיין אין בקשות.</p>'}
      <details><summary>גיבוי ושחזור נתונים</summary><div class="row" style="margin-top:8px">
        <button class="btn" data-g="export">הורד גיבוי (JSON)</button>
        <label class="btn">ייבוא מקובץ גיבוי<input type="file" accept=".json,application/json" id="importFile" hidden></label>
      </div><p class="muted" style="font-size:.8rem">ייבוא דורס את ההגדרות ואת השבועות שבקובץ.</p></details>
    </div></div></div>`;
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-g],[data-role],[data-delreq]'); if (!t) return;
  if (t.dataset.g === 'closeAdmin' && e.target !== t && t.classList.contains('scrim')) return; // click inside dialog
  const g = t.dataset.g;
  if (g === 'request') return signIn();
  if (g === 'out') return signOut(auth);
  if (g === 'admin') { if (!$('#admin')) { const m = document.createElement('div'); m.id = 'admin'; document.body.appendChild(m); } return renderAdmin(); }
  if (g === 'closeAdmin') { const m = $('#admin'); if (m) m.remove(); return; }
  if (g === 'copyLink') { const url = location.origin + location.pathname; try { await navigator.clipboard.writeText(url); gtoast('הקישור הועתק'); } catch (er) { prompt('הקישור לשיתוף:', url); } return; }
  if (g === 'export') return exportAll();
  if (t.dataset.role) { try { await setDoc(doc(fs, 'access', t.dataset.uid), { role: t.dataset.role, decidedAt: serverTimestamp() }, { merge: true }); gtoast('עודכן'); } catch (er) { gtoast('העדכון נכשל: ' + errMsg(er)); } return; }
  if (t.dataset.delreq) { if (!confirm('למחוק את הרשומה? המשתמש יאבד גישה ויוכל לבקש שוב.')) return; try { await deleteDoc(doc(fs, 'access', t.dataset.delreq)); } catch (er) { gtoast('המחיקה נכשלה'); } }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try { await importAll(JSON.parse(await e.target.files[0].text())); }
  catch (er) { gtoast('הייבוא נכשל: ' + (er.code ? errMsg(er) : er.message)); }
  e.target.value = '';
});

async function exportAll() {
  const out = { exportedAt: new Date().toISOString(), plan: {}, weeks: {} };
  for (const d of (await getDocs(collection(fs, 'plan'))).docs) out.plan[d.id] = d.data();
  for (const d of (await getDocs(collection(fs, 'weeks'))).docs) out.weeks[d.id] = d.data();
  await downloadsApi.save({ filename: `shavtzak-backup-${new Date().toISOString().slice(0, 10)}.json`, data: JSON.stringify(out, null, 2) });
}
async function importAll(data) {
  const plan = data.plan || {}, weeks = data.weeks || {};
  const n = Object.keys(plan).length + Object.keys(weeks).length;
  if (!n) throw new Error('הקובץ לא מכיל נתונים');
  if (!confirm(`לייבא ${n} מסמכים ולדרוס את הקיימים?`)) return;
  const b = writeBatch(fs);
  for (const [id, v] of Object.entries(plan)) b.set(doc(fs, 'plan', id), v);
  for (const [id, v] of Object.entries(weeks)) b.set(doc(fs, 'weeks', id), v);
  await b.commit();
  gtoast('הנתונים יובאו');
}
