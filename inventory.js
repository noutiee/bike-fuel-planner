
// inventory.js
(() => {
  const LS_KEY = 'bikeFuelPlanner.gelInventory.v1';
  const uid = () => (crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2));

  // ----- Storage -----
  const loadInventory = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? []; }
    catch { return []; }
  };
  const saveInventory = (list) => localStorage.setItem(LS_KEY, JSON.stringify(list));
  const addItem = (item) => { const l = loadInventory(); l.push(item); saveInventory(l); };
  const updateItem = (id, patch) => {
    const l = loadInventory();
    const i = l.findIndex(x => x.id === id);
    if (i >= 0) { l[i] = { ...l[i], ...patch, updatedAt: new Date().toISOString() }; saveInventory(l); }
  };
  const deleteItem = (id) => saveInventory(loadInventory().filter(x => x.id !== id));

  // ----- FEFO allocation -----
  function allocateFromInventory(requiredCarbs, options = {}) {
    const { includeExpired = false } = options;
    const today = new Date().toISOString().slice(0,10);
 
const inv = loadInventory()
  .sort((a,b) => a.expiry.localeCompare(b.expiry))
  .map(x => ({ ...x }));

    let remaining = Math.max(0, Math.round(requiredCarbs));
    const picks = [];

    for (const gel of inv) {
      if (remaining <= 0) break;
      if (gel.quantity <= 0 || gel.carbsPerGel <= 0) continue;

      const gelsNeeded = Math.ceil(remaining / gel.carbsPerGel);
      const used = Math.min(gelsNeeded, gel.quantity);

      if (used > 0) {
        picks.push({
          id: gel.id,
          name: gel.name,
          used,
          carbs: used * gel.carbsPerGel,
          expiry: gel.expiry,
          caffeineMg: gel.caffeineMg ?? 0,
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

  // ----- UI helpers -----
  const byId   = (id) => document.getElementById(id);
  const fmtDate= (d) => new Date(d).toLocaleDateString();
  const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000*60*60*24));

  function renderTable() {
    const tbody = byId('inventory-tbody');
    if (!tbody) return;

    const hideExpired = byId('toggle-hide-expired')?.checked ?? false;
    const today = new Date().toISOString().slice(0,10);

    const list = loadInventory()
      .filter(x => !hideExpired || x.expiry >= today)
      .sort((a,b) => a.expiry.localeCompare(b.expiry));

    tbody.innerHTML = '';

    for (const g of list) {
      const tr = document.createElement('tr');
      const d  = daysUntil(g.expiry);
      let badge = '';
      if (d < 0) badge = `<span class="badge-expired">expired</span>`;
      else if (d <= 30) badge = `<span class="badge-expiring">${d}d</span>`;

      tr.innerHTML = `
        <td>${g.name} ${badge}</td>
        <td>${g.carbsPerGel}</td>
        <td>${g.caffeineMg ?? ''}</td>
        <td>${fmtDate(g.expiry)}</td>
        <td>${g.quantity}</td>
        <td>
          <button data-edit="${g.id}">Edit</button>
          <button data-del="${g.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => { deleteItem(btn.dataset.del); renderTable(); });
    });
    tbody.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.edit;
        const g  = loadInventory().find(x => x.id === id);
        if (!g) return;
        const qty = Number(prompt('Quantity', g.quantity));
        if (!Number.isNaN(qty)) updateItem(id, { quantity: qty });
        renderTable();
      });
    });
  }

  function wireForm() {
    const form = byId('inventory-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name   = byId('gel-name').value.trim();
      const carbs  = Number(byId('gel-carbs').value);
      const caff   = byId('gel-caff').value ? Number(byId('gel-caff').value) : undefined;
      const expiry = byId('gel-expiry').value;
      const qty    = Number(byId('gel-qty').value);

      if (!name || carbs <= 0 || !expiry || qty <= 0) {
        alert('Please fill required fields correctly.');
        return;
      }

      const nowIso = new Date().toISOString();
      addItem({
        id: uid(),
        name,
        carbsPerGel: Math.round(carbs),
        caffeineMg: caff,
        expiry,
        quantity: Math.round(qty),
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      form.reset();
      renderTable();
    });

    byId('toggle-hide-expired')?.addEventListener('change', renderTable);

    byId('btn-export')?.addEventListener('click', () => {
      const data = JSON.stringify(loadInventory(), null, 2);
      const blob = new Blob([data], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gel-inventory.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    byId('file-import')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error('Invalid format');
          saveInventory(imported);
          renderTable();
        } catch {
          alert('Invalid JSON file.');
        }
      };
      reader.readAsText(file);
    });
  }

  // Public API for planner
  window.GelInventory = {
    loadInventory, saveInventory,
    allocateFromInventory, deductPlanFromInventory,
    renderTable
  };

  document.addEventListener('DOMContentLoaded', () => {
    wireForm(); renderTable();
  });
})();
