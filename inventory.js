
// inventory.v2.js - ES5-only, ASCII-only
(function () {
  var LS_KEY = 'bikeFuelPlanner.gelInventory.v1';

  function uid() {
    return (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID())
      ? window.crypto.randomUUID()
      : ('id-' + Math.random().toString(36).slice(2));
  }

  // ---- Date helpers (DD/MM/YY <-> ISO) ----
  function toISOFromDMY(input) {
    if (!input) return '';
    var m = String(input).trim().match(/^([0-3]?\d)\/([0-1]?\d)\/(\d{2}|\d{4})$/);
    if (!m) return '';
    var d = m[1], mo = m[2], y = m[3];
    d = ('0' + d).slice(-2);
    mo = ('0' + mo).slice(-2);
    if (y.length === 2) y = '20' + y;
    var iso = y + '-' + mo + '-' + d;
    var test = new Date(iso);
    if (isNaN(test.getTime())) return '';
    return iso;
  }
  function toDMYFromISO(iso) {
    if (!iso) return '';
    var m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var y = m[1], mo = m[2], d = m[3];
    return d + '/' + mo + '/' + y.slice(2);
  }
  function daysUntilISO(iso) {
    return Math.ceil((new Date(iso) - new Date()) / (1000 * 60 * 60 * 24));
  }

  // ---------- Storage ----------
  function loadInventory() {
    try {
      var x = localStorage.getItem(LS_KEY);
      return x ? JSON.parse(x) : [];
    } catch (e) { return []; }
  }
  function saveInventory(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    if (window.CloudSync && typeof window.CloudSync.save === 'function') {
      window.CloudSync.save(list);
    }
  }
  function addItem(item) { var l = loadInventory(); l.push(item); saveInventory(l); }
  function updateItem(id, patch) {
    var l = loadInventory();
    var i = -1;
    for (var k = 0; k < l.length; k++) { if (l[k].id === id) { i = k; break; } }
    if (i >= 0) {
      for (var key in patch) { l[i][key] = patch[key]; }
      l[i].updatedAt = new Date().toISOString();
      saveInventory(l);
    }
  }
  function deleteItem(id) {
    var l = loadInventory(), out = [];
    for (var i = 0; i < l.length; i++) { if (l[i].id !== id) out.push(l[i]); }
    saveInventory(out);
  }

function flattenInventory() {
  var inventory = loadInventory();
  var units = [];

  for (var i = 0; i < inventory.length; i++) {
    var g = inventory[i];
    var qty = Number(g.quantity) || 0;
    var carbs = Number(g.carbsPerGel) || 0;

    if (qty <= 0 || carbs <= 0) continue;

    for (var n = 0; n < qty; n++) {
      units.push({
        id: g.id,
        name: g.name,
        carbs: carbs,
        caffeineMg: g.caffeineMg || 0,
        expiry: g.expiry
      });
    }
  }

  return units;
}

  // ---------- SMART allocation (ES5) ----------
  function allocateSmart(requiredCarbs, opts) {
    opts = opts || {};
    var sport = opts.sport || 'bike';
    var maxGelCarbs = (typeof opts.maxGelCarbs === 'number') ? opts.maxGelCarbs : 30;
    var preferLarge = (typeof opts.preferLarge === 'boolean') ? opts.preferLarge : true;
    var expiryHorizonDays = (typeof opts.expiryHorizonDays === 'number') ? opts.expiryHorizonDays : 60;
    var scarcityProtect = (typeof opts.scarcityProtect === 'boolean') ? opts.scarcityProtect : true;
    var scarcityThreshold = (typeof opts.scarcityThreshold === 'number') ? opts.scarcityThreshold : 2;
    var scarcityExpirySafeDays = (typeof opts.scarcityExpirySafeDays === 'number') ? opts.scarcityExpirySafeDays : 90;
    var bigGelBenchmark = (typeof opts.bigGelBenchmark === 'number') ? opts.bigGelBenchmark : 40;

    var raw = loadInventory(), list = [];
    for (var i = 0; i < raw.length; i++) { list.push(Object.assign({}, raw[i])); }

    // candidates
    var candidates = [];
    for (var j = 0; j < list.length; j++) {
      var g = list[j];
      if ((g.quantity || 0) <= 0 || (g.carbsPerGel || 0) <= 0) continue;
      if (sport === 'run' && g.carbsPerGel > maxGelCarbs) continue;
      candidates.push(g);
    }

    function score(g) {
      var d = daysUntilISO(g.expiry);
      var expiryUrgency;
      if (isNaN(d)) expiryUrgency = 0.6;
      else if (d <= 0) expiryUrgency = 1.2;
      else expiryUrgency = Math.max(0, Math.min(1, (expiryHorizonDays - d) / expiryHorizonDays));

      var sizePref = 0.5;
      if (sport === 'bike') {
        sizePref = Math.max(0, Math.min(1, g.carbsPerGel / bigGelBenchmark));
        if (!preferLarge) sizePref = 0.5;
      } else if (sport === 'run') {
        sizePref = g.carbsPerGel <= maxGelCarbs ? 1 : Math.max(0, 1 - (g.carbsPerGel - maxGelCarbs) / maxGelCarbs);
      } else if (sport === 'swim') {
        sizePref = Math.max(0, Math.min(1, (35 - Math.abs(g.carbsPerGel - 30)) / 35));
      }

      var scarcityPenalty = 0;
      if (scarcityProtect) {
        if ((g.quantity || 0) <= scarcityThreshold && !isNaN(d) && d > scarcityExpirySafeDays) {
          scarcityPenalty = 0.3;
        }
      }

      var wExp = 0.5, wSize = 0.4, wScar = 0.2;
      if (sport === 'run') { wExp = 0.5; wSize = 0.6; wScar = 0.2; }
      if (sport === 'swim') { wExp = 0.7; wSize = 0.3; wScar = 0.2; }

      return (wExp * expiryUrgency + wSize * sizePref - wScar * scarcityPenalty);
    }

    candidates.sort(function (a, b) { return score(b) - score(a); });

    var remaining = Math.max(0, Math.round(requiredCarbs || 0));
    var picks = [];
    for (var c = 0; c < candidates.length; c++) {
      if (remaining <= 0) break;
      var g = candidates[c];
      var perGel = g.carbsPerGel;
      var canUse = Math.min(g.quantity, Math.ceil(remaining / perGel));
      if (canUse > 0) {
        picks.push({
          id: g.id, name: g.name, used: canUse, carbs: canUse * perGel,
          expiry: g.expiry, caffeineMg: (g.caffeineMg != null ? g.caffeineMg : 0)
        });
        g.quantity -= canUse;
        remaining = Math.max(0, remaining - canUse * perGel);
      }
    }

    return { picks: picks, shortage: remaining, updatedInventory: list };
  }

  function allocateFromInventory(requiredCarbs, opts) { return allocateSmart(requiredCarbs, opts); }

function deductPlanFromInventory(picks) {
  var list = loadInventory();
  if (!picks || !picks.length) return;

  // 1️⃣ Group total required quantity per gel id
  var required = {};
  for (var i = 0; i < picks.length; i++) {
    var p = picks[i];
    required[p.id] = (required[p.id] || 0) + (p.used || 1);
  }

  // 2️⃣ For each gel id, deduct FEFO
  Object.keys(required).forEach(function (gelId) {
    var remaining = required[gelId];

    // Collect matching inventory rows
    var batches = [];
    for (var j = 0; j < list.length; j++) {
      if (list[j].id === gelId && (list[j].quantity || 0) > 0) {
        batches.push(list[j]);
      }
    }

    // Sort by earliest expiry (FEFO)
    batches.sort(function (a, b) {
      if (!a.expiry && !b.expiry) return 0;
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return new Date(a.expiry) - new Date(b.expiry);
    });

    // Deduct from earliest expiry first
    for (var k = 0; k < batches.length && remaining > 0; k++) {
      var batch = batches[k];
      var take = Math.min(batch.quantity, remaining);
      batch.quantity -= take;
      remaining -= take;
      batch.updatedAt = new Date().toISOString();
    }
  });

  saveInventory(list);
}

  // ---------- UI ----------
  function $(id) { return document.getElementById(id); }
  
  var expandedBatches = {};

function renderTable() {
  var tbody = $('inventory-tbody');
  if (!tbody) return;

  var toggle = $('toggle-hide-expired');
  var hideExpired = toggle && toggle.checked ? true : false;
  var todayISO = new Date().toISOString().slice(0, 10);

  var raw = loadInventory().filter(function (x) {
    return !hideExpired || x.expiry >= todayISO;
  });

  // ---- group inventory by gel key ----
  var grouped = {};

  for (var i = 0; i < raw.length; i++) {
    var g = raw[i];
    var caff = (g.caffeineMg != null ? g.caffeineMg : 0);
    var key = g.name + '|' + g.carbsPerGel + '|' + caff;

    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        name: g.name,
        carbsPerGel: g.carbsPerGel,
        caffeineMg: caff,
        totalQty: 0,
        earliestExpiry: g.expiry,
        batches: []
      };
    }

    grouped[key].totalQty += Number(g.quantity) || 0;
    if (g.expiry < grouped[key].earliestExpiry) {
      grouped[key].earliestExpiry = g.expiry;
    }
    grouped[key].batches.push(g);
  }

  // ---- render table ----
  tbody.innerHTML = '';

  Object.keys(grouped).forEach(function (key) {
    var g = grouped[key];
    var tr = document.createElement('tr');

    var isOpen = !!expandedBatches[key];
    var caret = isOpen ? '▾' : '▸';

    tr.innerHTML =
      '<td>' +
        '<span class="batch-caret" ' +
              'data-key="' + key + '" ' +
              'style="cursor:pointer; font-size:1.2em; margin-right:6px;">' +
          caret +
        '</span>' +
        '<strong>' + g.name + '</strong>' +
      '</td>' +
      '<td>' + g.carbsPerGel + '</td>' +
      '<td>' + (g.caffeineMg || '') + '</td>' +
      '<td>' + toDMYFromISO(g.earliestExpiry) + '</td>' +
      '<td>' + g.totalQty + '</td>' +
      '<td></td>';

    tbody.appendChild(tr);

    // ---- render batch rows if expanded ----

if (isOpen) {

// Sort batches FEFO for display (earliest expiry first)
g.batches.sort(function (a, b) {
  if (!a.expiry && !b.expiry) return 0;
  if (!a.expiry) return 1;
  if (!b.expiry) return -1;
  return new Date(a.expiry) - new Date(b.expiry);
});

  // 1️⃣ Render batch rows
  for (var bi = 0; bi < g.batches.length; bi++) {
    var b = g.batches[bi];
    var br = document.createElement('tr');
    br.style.background = '#f8fafc';

    br.innerHTML =
      '<td style="padding-left:28px;">↳ ' + toDMYFromISO(b.expiry) + '</td>' +
      '<td></td>' +
      '<td></td>' +
      '<td></td>' +
      '<td>' + b.quantity + '</td>' +
      '<td>' +
        '<button data-dec="' + b.id + '">-1</button> ' +
        '<button data-edit="' + b.id + '">Edit</button> ' +
        '<button data-del="' + b.id + '">Delete</button>' +
      '</td>';

    tbody.appendChild(br);
  }

  // 2️⃣ Render "+ Add batch" ONCE, after all batches
  var addRow = document.createElement('tr');
  addRow.style.background = '#f8fafc';

  addRow.innerHTML =
    '<td style="padding-left:28px; cursor:pointer; font-style:italic;" ' +
        'class="add-batch-trigger" ' +
        'data-gel-key="' + key + '">' +
      '+ Add batch' +
    '</td>' +
    '<td></td><td></td><td></td><td></td><td></td>';

  tbody.appendChild(addRow);
}
      });

  // ---- wire caret clicks ----
  var carets = tbody.querySelectorAll('.batch-caret');
  for (var ci = 0; ci < carets.length; ci++) {
    carets[ci].addEventListener('click', function () {
      var key = this.dataset.key;
      expandedBatches[key] = !expandedBatches[key];
      renderTable();
    });
  }

  // ---- wire batch actions ----
  var dels = tbody.querySelectorAll('button[data-del]');
  for (var dli = 0; dli < dels.length; dli++) {
    dels[dli].addEventListener('click', function () {
      deleteItem(this.dataset.del);
      renderTable();
    });
  }

  var decs = tbody.querySelectorAll('button[data-dec]');
  for (var dci = 0; dci < decs.length; dci++) {
    decs[dci].addEventListener('click', function () {
      var id = this.dataset.dec;
      var listNow = loadInventory();
      for (var i = 0; i < listNow.length; i++) {
        if (listNow[i].id === id) {
          updateItem(id, { quantity: Math.max(0, listNow[i].quantity - 1) });
          break;
        }
      }
      renderTable();
    });
  }

  var edits = tbody.querySelectorAll('button[data-edit]');
  for (var ei = 0; ei < edits.length; ei++) {
    edits[ei].addEventListener('click', function () {
      var id = this.dataset.edit;
      var listNow = loadInventory();
      for (var i = 0; i < listNow.length; i++) {
        if (listNow[i].id === id) {
          var g = listNow[i];
          var qty = Number(prompt('Quantity', g.quantity));
          if (isFinite(qty)) updateItem(id, { quantity: Math.max(0, qty) });
          break;
        }
      }
      renderTable();
    });
  }
}

  function wireForm() {
    var form = $('inventory-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('gel-name').value.trim().replace(/\s+/g, ' ');
      var carbs = Number($('gel-carbs').value);
      var caffEl = $('gel-caff');
      var caff = (caffEl && caffEl.value) ? Number(caffEl.value) : undefined;
      var expiryDMY = $('gel-expiry').value.trim();
      var qty = Number($('gel-qty').value);
      var iso = toISOFromDMY(expiryDMY);

      if (!name || !isFinite(carbs) || carbs <= 0 || !iso || !isFinite(qty) || qty <= 0) {
        alert('Please fill in all required fields with valid values. Use DD/MM/YY for the date.');
        return;
      }
      var nowIso = new Date().toISOString();
      addItem({
        id: uid(), name: name, carbsPerGel: Math.round(carbs), caffeineMg: caff,
        expiry: iso, quantity: Math.round(qty), createdAt: nowIso, updatedAt: nowIso
      });
      form.reset();
      renderTable();
    });

    var toggle = $('toggle-hide-expired'); if (toggle) { toggle.addEventListener('change', renderTable); }

    // Export / Import
    var btnExport = $('btn-export');
    if (btnExport) {
      btnExport.addEventListener('click', function () {
        var data = JSON.stringify(loadInventory(), null, 2);
        var blob = new Blob([data], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gel-inventory.json';
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    var fileImport = $('file-import');
    if (fileImport) {
      fileImport.addEventListener('change', function (e) {
        var file = (e.target && e.target.files && e.target.files[0]) ? e.target.files[0] : null;
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = JSON.parse(String(reader.result || '[]'));
            if (!Array.isArray(parsed)) throw new Error('Invalid JSON format (expected an array).');
            var cleaned = [];
            for (var i = 0; i < parsed.length; i++) {
              var x = parsed[i];
              cleaned.push({
                id: x.id || uid(),
                name: String(x.name || '').trim(),
                carbsPerGel: Math.max(0, Math.round(Number(x.carbsPerGel || 0))),
                caffeineMg: (x.caffeineMg === '' || x.caffeineMg == null) ? undefined : Number(x.caffeineMg),
                expiry: toISOFromDMY(x.expiry) || x.expiry || '',
                quantity: Math.max(0, Math.round(Number(x.quantity || 0))),
                createdAt: x.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
              });
            }
            saveInventory(cleaned);
            renderTable();
            alert('Inventory imported');
          } catch (err) {
            alert('Import failed: ' + (err && err.message ? err.message : err));
          }
          e.target.value = '';
        };
        reader.readAsText(file);
      });
    }
  }

  // ---------- Public API ----------
window.GelInventory = {
  loadInventory: loadInventory,
  saveInventory: saveInventory,

  // REQUIRED by app.js (allocation + editor)
  flattenInventory: flattenInventory,

  allocateFromInventory: allocateFromInventory,
  deductPlanFromInventory: deductPlanFromInventory,
  renderTable: renderTable
};

// ===============================
// Add New Gel modal wiring
// ===============================

function wireAddGelModal() {
  var openBtn = document.getElementById('btn-add-gel');
  var modal = document.getElementById('add-gel-modal');
  var closeBtn = document.getElementById('close-add-gel');
  var form = document.getElementById('add-gel-form');

  if (!openBtn || !modal || !closeBtn || !form) return;

  // Open modal
  openBtn.addEventListener('click', function () {
    modal.style.display = 'flex';
  });

  // Close modal (X button)
  closeBtn.addEventListener('click', function () {
    modal.style.display = 'none';
    form.reset();
  });

  // Close modal when clicking outside card
  modal.addEventListener('click', function (e) {
    if (e.target === modal) {
      modal.style.display = 'none';
      form.reset();
    }
  });

  // Handle form submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name = document.getElementById('modal-gel-name').value.trim().replace(/\s+/g, ' ');
    var carbs = Number(document.getElementById('modal-gel-carbs').value);
    var caffRaw = document.getElementById('modal-gel-caff').value;
    var caff = (caffRaw === '' ? undefined : Number(caffRaw));
    var expiryDMY = document.getElementById('modal-gel-expiry').value.trim();
    var qty = Number(document.getElementById('modal-gel-qty').value);

    var iso = toISOFromDMY(expiryDMY);

    if (!name || !isFinite(carbs) || carbs <= 0 || !iso || !isFinite(qty) || qty <= 0) {
      alert('Please fill in all required fields with valid values. Use DD/MM/YY for the date.');
      return;
    }

    var nowIso = new Date().toISOString();

    addItem({
      id: uid(),
      name: name,
      carbsPerGel: Math.round(carbs),
      caffeineMg: caff,
      expiry: iso,
      quantity: Math.round(qty),
      createdAt: nowIso,
      updatedAt: nowIso
    });

    form.reset();
    modal.style.display = 'none';
    renderTable();
  });
}

// ===============================
// Add Batch modal wiring
// ===============================

function wireAddBatchModal() {
  var modal = document.getElementById('add-batch-modal');
  var closeBtn = document.getElementById('close-add-batch');
  var form = document.getElementById('add-batch-form');

  var nameInput = document.getElementById('batch-gel-name');
  var carbsInput = document.getElementById('batch-gel-carbs');
  var caffInput = document.getElementById('batch-gel-caff');
  var expiryInput = document.getElementById('batch-expiry');
  var qtyInput = document.getElementById('batch-qty');

  if (!modal || !closeBtn || !form) return;

  // Delegate click for "+ Add batch"
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('.add-batch-trigger');
    if (!trigger) return;

    var gelKey = trigger.dataset.gelKey;
    if (!gelKey) return;

    // gelKey format: name|carbs|caff
    var parts = gelKey.split('|');
    nameInput.value = parts[0];
    carbsInput.value = Number(parts[1]);
    caffInput.value = Number(parts[2]) || 0;

    expiryInput.value = '';
    qtyInput.value = '';

    modal.style.display = 'flex';
  });

  // Close modal (X)
  closeBtn.addEventListener('click', function () {
    modal.style.display = 'none';
    form.reset();
  });

  // Close modal on overlay click
  modal.addEventListener('click', function (e) {
    if (e.target === modal) {
      modal.style.display = 'none';
      form.reset();
    }
  });

  // Handle submit
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name = nameInput.value.trim();
    var carbs = Number(carbsInput.value);
    var caff = Number(caffInput.value) || 0;
    var expiryDMY = expiryInput.value.trim();
    var qty = Number(qtyInput.value);

    var iso = toISOFromDMY(expiryDMY);

    if (!name || !isFinite(carbs) || !iso || !isFinite(qty) || qty <= 0) {
      alert('Please enter a valid expiry date and quantity.');
      return;
    }

    var nowIso = new Date().toISOString();

    addItem({
      id: uid(),
      name: name,
      carbsPerGel: Math.round(carbs),
      caffeineMg: caff,
      expiry: iso,
      quantity: Math.round(qty),
      createdAt: nowIso,
      updatedAt: nowIso
    });

    form.reset();
    modal.style.display = 'none';
    renderTable();
  });
}


document.addEventListener('DOMContentLoaded', function () {
  wireForm();
  wireAddGelModal();
  wireAddBatchModal();
  renderTable();
});
})();
