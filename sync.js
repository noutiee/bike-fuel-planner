
// sync.js – Cloud sync for Bike Fuel Planner (Google sign-in + Firestore)
// Works with Firebase compat CDN scripts (no bundler needed).
//
// Firestore structure:
//   collection: "inventories"
//   document id: <user.uid>
//   document: { items: [...], updatedAt: serverTimestamp(), version: 1 }
//
// Local storage key must match inventory.js:
//   'bikeFuelPlanner.gelInventory.v1'

(function () {
  // 1) Your Firebase config (from your console)
  const firebaseConfig = {
    apiKey: "AIzaSyCsO3m4FqCZaRrP0RQu30uCiWVD0fwBcX4",
    authDomain: "bike-fuel-planner.firebaseapp.com",
    projectId: "bike-fuel-planner",
    storageBucket: "bike-fuel-planner.firebasestorage.app",
    messagingSenderId: "849558056285",
    appId: "1:849558056285:web:391b326ffc7ae5d284ccb4",
    measurementId: "G-TF01V4FKBS"
  };

  // 2) Initialize Firebase (compat)
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // (Optional) enable offline cache; if it errors (e.g., multiple tabs), we ignore.
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  // 3) Constants
  const LS_KEY = 'bikeFuelPlanner.gelInventory.v1';
  const COL    = 'inventories';

  // 4) Runtime state
  let unsub = null;              // Firestore onSnapshot unsubscribe
  let currentUid = null;         // signed-in user id
  let suppressLocalWatcher = false; // prevent echo loops when we apply remote to local

  // 5) Helpers
  function lastUpdated(list) {
    let t = 0;
    for (const it of (list || [])) {
      const d = Date.parse(it?.updatedAt || it?.createdAt || 0) || 0;
      if (d > t) t = d;
    }
    return t;
  }

  function shouldUseRemote(localList, remoteList) {
    return lastUpdated(remoteList) > lastUpdated(localList);
  }

  async function saveLocal(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list || []));
    // Update table if the inventory UI is present
    if (window.GelInventory?.renderTable) {
      try { window.GelInventory.renderTable(); } catch { /* no-op */ }
    }
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

  // 6) Simple auth controls for your buttons
  window.signIn = async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Optional: prompt account selection every time
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithPopup(provider);
  };

  window.signOut = async function signOut() {
    await auth.signOut();
  };

  // 7) When auth state changes, (re)wire sync
  auth.onAuthStateChanged(async (user) => {
    // Clean previous listener (if any)
    if (unsub) { try { unsub(); } catch {} ; unsub = null; }
    currentUid = user?.uid || null;

    if (!currentUid) {
      console.log('[sync] Signed out — local-only mode.');
      return;
    }

    const ref = db.collection(COL).doc(currentUid);

    // One-time merge: pick newer of local vs remote, then write winner to both
    let remote = [];
    try {
      const snap = await ref.get();
      remote = snap?.exists ? (snap.data().items || []) : [];
    } catch {
      remote = [];
    }

    const local = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    let winner = local;
    if (remote.length && shouldUseRemote(local, remote)) {
      winner = remote;
    }

    suppressLocalWatcher = true;
    await saveLocal(winner);
    suppressLocalWatcher = false;

    try { await saveRemote(currentUid, winner); } catch {}

    // Live stream: whenever remote changes and is newer, apply to local
    unsub = ref.onSnapshot((s) => {
      const incoming = s.data()?.items || [];
      const currentLocal = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      if (shouldUseRemote(currentLocal, incoming)) {
        suppressLocalWatcher = true;
        saveLocal(incoming).finally(() => { suppressLocalWatcher = false; });
      }
    });
  });

  // 8) API for inventory.js to call after local saves
  window.CloudSync = {
    save(list) {
      if (!currentUid) return;           // Not signed in → local only
      if (suppressLocalWatcher) return;  // Avoid echo when we just applied remote
      saveRemote(currentUid, list).catch(() => {});
    }
  };
})();
