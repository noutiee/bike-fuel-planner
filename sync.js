
// sync.js – Cloud sync for Bike Fuel Planner (Google sign-in + Firestore)
// Works with Firebase compat CDN scripts (no bundler).
//
// Firestore structure:
//   collection: "inventories"
//   document id: <user.uid>
//   document: { items: [...], updatedAt: serverTimestamp(), version: 1 }
//
// Local storage key must match inventory.js:
//   'bikeFuelPlanner.gelInventory.v1'

(function () {
  // ---- 1) Firebase config (yours) ----
  const firebaseConfig = {
    apiKey: "AIzaSyCsO3m4FqCZaRrP0RQu30uCiWVD0fwBcX4",
    authDomain: "bike-fuel-planner.firebaseapp.com",
    projectId: "bike-fuel-planner",
    storageBucket: "bike-fuel-planner.firebasestorage.app",
    messagingSenderId: "849558056285",
    appId: "1:849558056285:web:391b326ffc7ae5d284ccb4",
    measurementId: "G-TF01V4FKBS"
  };

  // ---- 2) Init Firebase (compat) ----
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // NOTE: We intentionally DO NOT call enablePersistence() here to avoid
  // the current deprecation warning in the console. Regular online sync
  // works fine without it. (We can switch to the new cache API later.)

  // ---- 3) Constants / DOM helpers ----
  const LS_KEY = 'bikeFuelPlanner.gelInventory.v1';
  const COL    = 'inventories';

  const $ = (id) => document.getElementById(id);
  const elSignIn     = $('btnSignIn');
  const elSignOut    = $('btnSignOut');
  const elSignedInAs = $('signedInAs');
  const elForcePull  = $('btnForcePull');

  // ---- 4) Runtime state ----
  let unsub = null;                // Firestore onSnapshot unsubscribe
  let currentUser = null;          // firebase.User
  let suppressLocalWatcher = false;

  // ---- 5) Helpers ----
  function lastUpdated(list) {
    let t = 0;
    for (const it of (list || [])) {
      const d = Date.parse(it?.updatedAt || it?.createdAt || 0) || 0;
      if (d > t) t = d;
    }
    return t;
  }
  function isRemoteNewer(localList, remoteList) {
    return lastUpdated(remoteList) > lastUpdated(localList);
  }
  async function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { return []; }
  }
  async function saveLocal(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list || []));
    if (window.GelInventory?.renderTable) {
      try { window.GelInventory.renderTable(); } catch {}
    }
  }
  async function readRemote(uid) {
    const ref = db.collection(COL).doc(uid);
    const snap = await ref.get();
    return snap?.exists ? (snap.data().items || []) : [];
  }
  async function saveRemote(uid, list) {
    const ref = db.collection(COL).doc(uid);
    await ref.set(
      {
        items: list || [],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        version: 1
      },
      { merge: true }
    );
  }

  // ---- 6) UI updates ----
  function setSignedOutUI() {
    if (elSignIn)     elSignIn.style.display = 'inline-block';
    if (elSignOut)    elSignOut.style.display = 'none';
    if (elSignedInAs) elSignedInAs.textContent = '';
    if (elForcePull)  elForcePull.style.display = 'none';
  }
  function setSignedInUI(user) {
    if (elSignIn)     elSignIn.style.display = 'none';
    if (elSignOut)    elSignOut.style.display = 'inline-block';
    if (elSignedInAs) elSignedInAs.textContent = `Signed in as ${user.email || user.uid}`;
    if (elForcePull)  elForcePull.style.display = 'inline-block';
  }

  // ---- 7) Public sign-in/out (used by your buttons) ----
  window.signIn = async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Try popup first, fall back to redirect if popup blocked or COOP issues
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      // If the domain isn't authorized or popup is blocked, redirect is safer
      await auth.signInWithRedirect(provider);
    }
  };

  window.signOut = async function signOut() {
    await auth.signOut();
  };

  // Handle redirect result (iOS/Safari, or when popup fallback triggers redirect)
  auth.getRedirectResult().catch(() => { /* ignore */ });

  // ---- 8) Force sync actions (handy for testing) ----
  // Overwrite local with remote (pull)
  async function forcePullFromCloud() {
    if (!currentUser) return;
    try {
      const remote = await readRemote(currentUser.uid);
      suppressLocalWatcher = true;
      await saveLocal(remote);
      suppressLocalWatcher = false;
      alert('Local inventory replaced with cloud version ✅');
    } catch (e) {
      console.error('[sync] forcePullFromCloud error:', e);
      alert('Force pull failed. See console for details.');
    }
  }
  elForcePull?.addEventListener('click', forcePullFromCloud);

  // ---- 9) Auth → wire sync ----
  auth.onAuthStateChanged(async (user) => {
    // Clean old listener
    if (unsub) { try { unsub(); } catch {} ; unsub = null; }

    currentUser = user || null;

    if (!currentUser) {
      setSignedOutUI();
      return; // local-only mode
    }

    setSignedInUI(currentUser);
    const uid = currentUser.uid;
    const ref = db.collection(COL).doc(uid);

    // One-time merge on login: pick newer of local vs remote, then write winner to both
    let remote = [];
    try { remote = await readRemote(uid); } catch { remote = []; }
    const local = await readLocal();

    let winner = local;
    if (remote.length && isRemoteNewer(local, remote)) winner = remote;

    // Apply winner to local first (avoid flicker), then to cloud
    suppressLocalWatcher = true;
    await saveLocal(winner);
    suppressLocalWatcher = false;
    try { await saveRemote(uid, winner); } catch {}

    // Live stream: apply newer remote to local
    unsub = ref.onSnapshot((s) => {
      const incoming = s.data()?.items || [];
      readLocal().then(curr => {
        if (isRemoteNewer(curr, incoming)) {
          suppressLocalWatcher = true;
          saveLocal(incoming).finally(() => { suppressLocalWatcher = false; });
        }
      });
    });
  });

  // ---- 10) API for inventory.js to push local changes ----
  window.CloudSync = {
    save(list) {
      if (!currentUser) return;          // Not signed in → local only
      if (suppressLocalWatcher) return;  // Avoid echo during remote->local apply
      saveRemote(currentUser.uid, list).catch((e) => {
        // Non-fatal (offline or transient). Will sync next time.
        // console.warn('[sync] cloud save failed:', e);
      });
    }
  };
})();
