
// inventory.js (DD/MM/YY + FEFO + expired allowed + manual deduct)
(() => {
  const LS_KEY = 'bikeFuelPlanner.gelInventory.v1';
  const uid = () => (crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2));

  // ---- Date helpers (DD/MM/YY <-> ISO) ----
  function toISOFromDMY(input) {
    // Accepts DD/MM/YY or DD/MM/YYYY; returns 'YYYY-MM-DD'
    if (!input) return '';
    const m = String(input).trim().match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{2}|\d{4})$/);
    if (!m) return '';
    let [_, d, mo, y] = m;
    d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
    if (y.length === 2) y = '20' + y; // interpret 2-digit year as 20YY
    const iso = `${y}-${mo}-${d}`;
    // Basic validity check
    const test = new Date(iso);
    if (isNaN(test.getTime())) return '';
    return iso;
  }
  function toDMYFromISO(iso) {
    if (!iso) return '';
    const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const [_, y, mo, d] = m;
    return `${d}/${mo}/${y.slice(2)}`; // DD/MM/YY
  }
  function daysUntilISO(iso) {
    const ms = (new Date(iso) - new Date());
    return Math.ceil(ms / (1000*60*60*24));
  }

  // ---------- Storage ----------
  function loadInventory() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? []; }
    catch { return []; }
  }

  // 🔄 UPDATED: also push to cloud (if signed in) after local save
  function saveInventory(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    window.CloudSync?.save(list); // <= pushes to Firestore when signed in
  }

  function addItem(item) { const l = loadInventory(); l.push(item); saveInventory(l); }

  function updateItem(id, patch) {
    const l = loadInventory();
    const i = l.findIndex(x => x.id === id);
    if (i >= 0) {
      l[i] = { ...l[i], ...patch, updatedAt: new Date().toISOString() };
      saveInventory(l);
    }
  }

  function deleteItem(id) { saveInventory(loadInventory().filter(x => x.id !== id)); }

  // ---------- FEFO allocation (expired allowed) ----------
  function allocateFromInventory(requiredCarbs) {
    const inv = loadInventory()
      .sort((a,b) => a.expiry.localeCompare(b.expiry))
      .map(x => ({ ...x }));

    let remaining = Math.max(0, Math.round(requiredCarbs));
    const picks = [];

    for (const gel of inv) {
      if (remaining <= 0) break;
      if ((gel.quantity||0) <= 0 || (gel.carbsPerGel||0) <= 0) continue;
      const gelsNeeded = Math.ceil(remaining / gel.carbsPerGel);
      const used = Math.min(gelsNeeded, gel.quantity);
      if (used > 0) {
        picks.push({
          id: gel.id,
          name: gel.name,
          used,
          carbs: used * gel.carbsPerGel,
          expiry: gel.expiry,
          caffeineMg: gel.caffeineMg ?? 0
        });
        gel.quantity -= used;
        remaining = Math.max(0, remaining - used * gel.carbsPerGel);
      }
    }
    return { picks, shortage: remaining, updatedInventory: inv };
  }

  function deductPlanFromInventory(picks) {
    const list = loadInventory();
    for (const p of picks) {
      const i = list.findIndex(x => x.id === p.id);
      if (i >= 0) {
        list[i].quantity = Math.max(0, (list[i].quantity || 0) - p.used);
        list[i].updatedAt = new Date().toISOString();
      }
    }
    saveInventory(list);
  }

  // ---------- UI wiring ----------
  const $ = id => document.getElementById(id);

  function renderTable() {
    const tbody = $('inventory-tbody');
    if (!tbody) return;

    const hideExpired = $('toggle-hide-expired')?.checked ?? false;
    const todayISO = new Date().toISOString().slice(0,10);

    const list = loadInventory()
      .filter(x => !hideExpired || x.expiry >= todayISO)
      .sort((a,b) => a.expiry.localeCompare(b.expiry));

    tbody.innerHTML = '';
    for (const g of list) {
      const tr = document.createElement('tr');
      const d = daysUntilISO(g.expiry);
      let badge = '';
      if (d < 0) badge = '<span class="badge-expired">expired</span>';
      else if (d <= 30) badge = `<span class="badge-expiring">${d}d</span>`;
      tr.innerHTML = `
        <td>${g.name} ${badge}</td>
        <td>${g.carbsPerGel}</td>
        <td>${g.caffeineMg ?? ''}</td>
        <td>${toDMYFromISO(g.expiry)}</td>
        <td>${g.quantity}</td>
        <td>
          <button data-dec="${g.id}">–1</button>
          <button data-edit="${g.id}">Edit</button>
          <button data-del="${g.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    }

    // Actions
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => { deleteItem(btn.dataset.del); renderTable(); });
    });
    tbody.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.edit;
        const g  = loadInventory().find(x => x.id === id);
        if (!g) return;

        const name = (prompt('Name', g.name) ?? g.name).trim();
        const carbs = Number(prompt('Carbs per gel (g)', g.carbsPerGel));
        const caff  = prompt('Caffeine (mg, optional)', g.caffeineMg ?? '');
        const qty   = Number(prompt('Quantity', g.quantity));
        const dmy   = prompt('Expiry (DD/MM/YY)', toDMYFromISO(g.expiry)) || toDMYFromISO(g.expiry);
        const iso   = toISOFromDMY(dmy) || g.expiry;

        updateItem(id, {
          name: name || g.name,
          carbsPerGel: Number.isFinite(carbs) ? Math.max(0, Math.round(carbs)) : g.carbsPerGel,
          caffeineMg: caff === '' ? undefined : Number(caff),
          quantity: Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : g.quantity,
          expiry: iso
        });
        renderTable();
      });
    });
    tbody.querySelectorAll('button[data-dec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.dec;
        const item = loadInventory().find(x => x.id === id);
        if (!item) return;
        updateItem(id, { quantity: Math.max(0, (item.quantity||0) - 1) });
        renderTable();
      });
    });
  }

  function wireForm() {
    const form = $('inventory-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name   = $('gel-name').value.trim().replace(/\s+/g, ' ');
      const carbs  = Number($('gel-carbs').value);
      const caff   = $('gel-caff').value ? Number($('gel-caff').value) : undefined;
      const expiryDMY = $('gel-expiry').value.trim();
      const qty    = Number($('gel-qty').value);
      const iso = toISOFromDMY(expiryDMY);

      if (!name || !Number.isFinite(carbs) || carbs <= 0 || !iso || !Number.isFinite(qty) || qty <= 0) {
        alert('Please fill in all required fields with valid values. Use DD/MM/YY for the date.');
        return;
      }
      const nowIso = new Date().toISOString();
      addItem({
        id: uid(),
        name,
        carbsPerGel: Math.round(carbs),
        caffeineMg: caff,
        expiry: iso,
        quantity: Math.round(qty),
        createdAt: nowIso,
        updatedAt: nowIso
      });
      form.reset();
      renderTable();
    });
    $('toggle-hide-expired')?.addEventListener('change', renderTable);

    // ----- Optional: Export / Import helpers -----
    const btnExport = $('btn-export');
    const fileImport = $('file-import');

    btnExport?.addEventListener('click', () => {
      const data = JSON.stringify(loadInventory(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gel-inventory.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    fileImport?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Invalid JSON format (expected an array).');
        // Basic shape check (non-fatal)
        const cleaned = parsed.map(x => ({
          id: x.id || uid(),
          name: String(x.name || '').trim(),
          carbsPerGel: Math.max(0, Math.round(Number(x.carbsPerGel || 0))),
          caffeineMg: (x.caffeineMg === '' || x.caffeineMg == null) ? undefined : Number(x.caffeineMg),
          expiry: toISOFromDMY(x.expiry) || x.expiry || '',
          quantity: Math.max(0, Math.round(Number(x.quantity || 0))),
          createdAt: x.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));
        saveInventory(cleaned);
        renderTable();
        alert('Inventory imported ✅');
      } catch (err) {
        alert('Import failed: ' + (err?.message || err));
      } finally {
        e.target.value = '';
      }
    });
    // ----- End optional helpers -----
  }

  // Public API
  window.GelInventory = {
    loadInventory,
    saveInventory,
    allocateFromInventory,
    deductPlanFromInventory,
    renderTable
  };

  document.addEventListener('DOMContentLoaded', () => { wireForm(); renderTable(); });
})();
