
// inventory.js (DD/MM/YY + FEFO + expired allowed + manual deduct)
(() => {
  const LS_KEY = 'bikeFuelPlanner.gelInventory.v1';
  const uid = () => (crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2));

  // ---- Date helpers (DD/MM/YY <-> ISO) ----
  function toISOFromDMY(input) {
    if (!input) return '';
    const m = String(input).trim().match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{2}|\d{4})$/);
    if (!m) return '';
    let [_, d, mo, y] = m;
    d = d.padStart(2, '0'); mo = mo.padStart(2, '0');
    if (y.length === 2) y = '20' + y;
    const iso = `${y}-${mo}-${d}`;
    const test = new Date(iso);
    if (isNaN(test.getTime())) return '';
    return iso;
  }
  function toDMYFromISO(iso) {
    if (!iso) return '';
    const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const [_, y, mo, d] = m;
    return `${d}/${mo}/${y.slice(2)}`;
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
  function saveInventory(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    // Cloud sync if available
    window.CloudSync?.save(list);
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

  // ---------- SMART allocation ----------
  /**
   * Allocate gels from inventory toward required carbs using a scoring model.
   * Options:
   *  - sport: 'bike' | 'run' | 'swim'
   *  - maxGelCarbs (run): default 30
   *  - preferLarge (bike): default true
   *  - expiryHorizonDays: default 60
   *  - scarcityProtect: default true
   */
  function allocateSmart(requiredCarbs, opts = {}) {
    const {
      sport = 'bike',
      maxGelCarbs = 30,
      preferLarge = true,
      expiryHorizonDays = 60,
      scarcityProtect = true,
      scarcityThreshold = 2,
      scarcityExpirySafeDays = 90,
      bigGelBenchmark = 40
    } = opts;

    const list = loadInventory().map(x => ({ ...x }));

    const candidates = list.filter(g => {
      if ((g.quantity||0) <= 0 || (g.carbsPerGel||0) <= 0) return false;
      if (sport === 'run' && g.carbsPerGel > maxGelCarbs) return false;
      return true;
    });

    function score(g) {
      const d = daysUntilISO(g.expiry);
      let expiryUrgency;
      if (isNaN(d))      expiryUrgency = 0.6;
      else if (d <= 0)   expiryUrgency = 1.2;
      else               expiryUrgency = Math.max(0, Math.min(1, (expiryHorizonDays - d) / expiryHorizonDays));

      let sizePref = 0.5;
      if (sport === 'bike') {
        sizePref = Math.max(0, Math.min(1, g.carbsPerGel / bigGelBenchmark));
        if (!preferLarge) sizePref = 0.5;
      } else if (sport === 'run') {
        sizePref = g.carbsPerGel <= maxGelCarbs ? 1 : Math.max(0, 1 - (g.carbsPerGel - maxGelCarbs)/maxGelCarbs);
      } else if (sport === 'swim') {
        sizePref = Math.max(0, Math.min(1, (35 - Math.abs(g.carbsPerGel - 30)) / 35));
      }

      let scarcityPenalty = 0;
      if (scarcityProtect) {
        if ((g.quantity||0) <= scarcityThreshold && !isNaN(d) && d > scarcityExpirySafeDays) {
          scarcityPenalty = 0.3;
        }
      }

      let wExp = 0.5, wSize = 0.4, wScar = 0.2;
      if (sport === 'run')  { wExp = 0.5; wSize = 0.6; wScar = 0.2; }
      if (sport === 'swim') { wExp = 0.7; wSize = 0.3; wScar = 0.2; }

      return (wExp*expiryUrgency + wSize*sizePref - wScar*scarcityPenalty);
    }

    candidates.sort((a, b) => score(b) - score(a));

    let remaining = Math.max(0, Math.round(requiredCarbs));
    const picks = [];

    for (const g of candidates) {
      if (remaining <= 0) break;
      const perGel = g.carbsPerGel;
      const canUse = Math.min(g.quantity, Math.ceil(remaining / perGel));
      if (canUse > 0) {
        picks.push({
          id: g.id, name: g.name, used: canUse, carbs: canUse * perGel,
          expiry: g.expiry, caffeineMg: g.caffeineMg ?? 0
        });
        g.quantity -= canUse;
        remaining = Math.max(0, remaining - canUse * perGel);
      }
    }

    return { picks, shortage: remaining, updatedInventory: list };
  }

  function allocateFromInventory(requiredCarbs, opts) {
    return allocateSmart(requiredCarbs, opts);
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

    // Optional: export/import
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
  }

  // Public API
  window.GelInventory = {
    loadInventory,
    saveInventory,
    allocateFromInventory, // wraps allocateSmart
    deductPlanFromInventory,
    renderTable
  };

  document.addEventListener('DOMContentLoaded', () => { wireForm(); renderTable(); });
})();
