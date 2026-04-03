
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
    for (var i = 0; i < (picks || []).length; i++) {
      var p = picks[i];
      var idx = -1;
      for (var k = 0; k < list.length; k++) { if (list[k].id === p.id) { idx = k; break; } }
      if (idx >= 0) {
        list[idx].quantity = Math.max(0, (list[idx].quantity || 0) - p.used);
        list[idx].updatedAt = new Date().toISOString();
      }
    }
    saveInventory(list);
  }

  // ---------- UI ----------
  function $(id) { return document.getElementById(id); }

  function renderTable() {
    var tbody = $('inventory-tbody');
    if (!tbody) return;

    var toggle = $('toggle-hide-expired');
    var hideExpired = toggle && toggle.checked ? true : false;
    var todayISO = new Date().toISOString().slice(0, 10);

    var list = loadInventory().filter(function (x) { return !hideExpired || x.expiry >= todayISO; });
    list.sort(function (a, b) { return a.expiry.localeCompare(b.expiry); });

    tbody.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      var tr = document.createElement('tr');
      var d = daysUntilISO(g.expiry);
      var badge = '';
      if (d < 0) badge = '<span class="badge-expired">expired</span>';
      else if (d <= 30) badge = '<span class="badge-expiring">' + d + 'd</span>';
      tr.innerHTML =
        '<td>' + g.name + ' ' + badge + '</td>' +
        '<td>' + g.carbsPerGel + '</td>' +
        '<td>' + (g.caffeineMg != null ? g.caffeineMg : '') + '</td>' +
        '<td>' + toDMYFromISO(g.expiry) + '</td>' +
        '<td>' + g.quantity + '</td>' +
        '<td>' +
        '<button data-dec="' + g.id + '">-1</button>' +
        '<button data-edit="' + g.id + '">Edit</button>' +
        '<button data-del="' + g.id + '">Delete</button>' +
        '</td>';
      tbody.appendChild(tr);
    }

    // Actions
    var dels = tbody.querySelectorAll('button[data-del]');
    for (var dli = 0; dli < dels.length; dli++) {
      dels[dli].addEventListener('click', function () { deleteItem(this.dataset.del); renderTable(); });
    }
    var edits = tbody.querySelectorAll('button[data-edit]');
    for (var edi = 0; edi < edits.length; edi++) {
      edits[edi].addEventListener('click', function () {
        var id = this.dataset.edit;
        var listNow = loadInventory(), g = null;
        for (var q = 0; q < listNow.length; q++) { if (listNow[q].id === id) { g = listNow[q]; break; } }
        if (!g) return;

        var name = (prompt('Name', g.name) || g.name).trim();
        var carbs = Number(prompt('Carbs per gel (g)', g.carbsPerGel));
        var caff = prompt('Caffeine (mg, optional)', (g.caffeineMg != null ? g.caffeineMg : ''));
        var qty = Number(prompt('Quantity', g.quantity));
        var dmy = prompt('Expiry (DD/MM/YY)', toDMYFromISO(g.expiry)) || toDMYFromISO(g.expiry);
        var iso = toISOFromDMY(dmy) || g.expiry;

        updateItem(id, {
          name: name || g.name,
          carbsPerGel: isFinite(carbs) ? Math.max(0, Math.round(carbs)) : g.carbsPerGel,
          caffeineMg: (caff === '' || caff === null) ? undefined : Number(caff),
          quantity: isFinite(qty) ? Math.max(0, Math.round(qty)) : g.quantity,
          expiry: iso
        });
        renderTable();
      });
    }
    var decs = tbody.querySelectorAll('button[data-dec]');
    for (var dci = 0; dci < decs.length; dci++) {
      decs[dci].addEventListener('click', function () {
        var id = this.dataset.dec;
        var item = null, lnow = loadInventory();
        for (var a = 0; a < lnow.length; a++) { if (lnow[a].id === id) { item = lnow[a]; break; } }
        if (!item) return;
        updateItem(id, { quantity: Math.max(0, (item.quantity || 0) - 1) });
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
    allocateFromInventory: allocateFromInventory,
    deductPlanFromInventory: deductPlanFromInventory,
    renderTable: renderTable
  };

  document.addEventListener('DOMContentLoaded', function () { wireForm(); renderTable(); });
})();
