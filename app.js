
// app.js – Main application logic (UI + calculation + summary)
// ES5 compatible, NO HTML entities

(function () {
  function $(id) { return document.getElementById(id); }

var GelInventory = (function () {

  var STORAGE_KEY = 'gelInventory';

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  }

  function save(inventory) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
  }

  function gelId(name, carbs, caffeine) {
    return (
      name.toLowerCase().replace(/\s+/g, '-') +
      '-' + carbs +
      '-' + (caffeine || 0)
    );
  }

function flattenInventory() {
  var inventory = load();
  var units = [];

  inventory.forEach(function (gel) {
    var qty = Number(gel.qty) || 0;
    var carbs = Number(gel.carbs) || 0;

    // ignore empty or invalid inventory rows
    if (qty <= 0 || carbs <= 0) return;

    for (var i = 0; i < qty; i++) {
      units.push({
        id: gel.id || gel.name,
        name: gel.name,
        carbs: carbs,
        caffeineMg: gel.caffeineMg || 0,
        expiry: gel.expiry
      });
    }
  });

  return units;
}

  return {
    loadInventory: load,
    saveInventory: save,
    gelId: gelId,
    flattenInventory: flattenInventory
  };

})();

  
  /* -----------------------------
     Slider ↔ Number input sync
  ------------------------------ */
  function linkSlider(sliderId, inputId, max) {
    var s = $(sliderId), i = $(inputId);
    if (!s || !i) return;

    s.addEventListener('input', function () {
      i.value = s.value;
    });

    i.addEventListener('input', function () {
      var v = Number(i.value);
      if (isFinite(v)) s.value = Math.min(v, max);
    });
  }

  linkSlider('swimSlider', 'swimMinutes', 60);
  linkSlider('bikeSlider', 'bikeMinutes', 300);
  linkSlider('runSlider',  'runMinutes', 120);

  /* -----------------------------
     +/- buttons for carbs/hour
  ------------------------------ */
  document.addEventListener('click', function (e) {
    var b = e.target;
    if (!b.dataset || !b.dataset.target) return;

    var i = $(b.dataset.target);
    if (!i) return;

    var step = Number(b.dataset.step) || 0;
    var v = Number(i.value) || 0;
    i.value = Math.max(0, v + step);
  });

  /* -----------------------------
     Helpers
  ------------------------------ */
  function minutesToHours(id) {
    return (Number($(id).value) || 0) / 60;
  }

  function round(x, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(x * p) / p;
  }

function gelSummary(picks) {
  var count = picks.length;
  var carbs = picks.reduce(function (s, p) { return s + p.carbs; }, 0);
  var perGel = count ? Math.round(carbs / count) : 0;
  return {
    count: count,
    perGel: perGel,
    carbs: Math.round(carbs)
  };
}

// ---- Manual override state ----
var activeEditDiscipline = null; // 'Swim' | 'Bike' | 'Run' | null
var draftPicks = null;           // temporary editable picks for that discipline
 
var manualOverrides = {
  Swim: null,
  Bike: null,
  Run: null
};
 
// ---------- Summary grid renderers ----------

function renderSummaryHeader() {
  return (
    '<div class="summary-grid header">' +
      '<div>Discipline</div>' +
      '<div class="summary-cell center">Duration</div>' +
      '<div class="summary-cell center">Target</div>' +
      '<div>Gels</div>' +
      '<div class="summary-cell center">Bottles</div>' +
      '<div class="summary-cell center">Total</div>' +
    '</div>'
  );
}

function renderSummaryRow(label, hours, target, gelPicks, bottleCarbs) {
  if (!hours || hours <= 0) return '';

  var gels = gelPicks || [];
  var gelText = '–';
  var totalGelCarbs = 0;

  if (gels.length > 0) {
    var sizes = gels.map(function (g) { return g.carbs; });
    totalGelCarbs = sizes.reduce(function (s, c) { return s + c; }, 0);

    var first = sizes[0];
    var uniform = sizes.every(function (c) { return c === first; });

    if (uniform) {
      gelText = sizes.length + ' × ' + first + ' g = ' + totalGelCarbs + ' g';
    } else {
      gelText = sizes.join(' + ') + ' = ' + totalGelCarbs + ' g';
    }
  }

var total = Math.round(totalGelCarbs + bottleCarbs);

  var rowHtml =
    '<div class="summary-grid row">' +
      '<div><strong>' + label + '</strong></div>' +
      '<div class="summary-cell center">' + round(hours, 2) + ' h</div>' +
      '<div class="summary-cell center">' + Math.round(target) + ' g</div>' +
      '<div>' + gelText + '</div>' +
      '<div class="summary-cell center">' +
        (bottleCarbs ? Math.round(bottleCarbs) + ' g' : '–') +
      '</div>' +
      '<div class="summary-cell center">' + total + ' g</div>' +
      '<div class="summary-cell center">' +
        (hours > 0
          ? '<button class="ghost edit-btn" data-discipline="' + label + '" title="Edit allocation">✏</button>'
          : ''
        ) +
      '</div>' +
    '</div>';

  return rowHtml;
}

function renderSummaryTotalRow(target, actual) {
  return (
    '<div class="summary-grid total">' +
      '<div><strong>Total</strong></div>' +
      '<div></div>' +
      '<div class="summary-cell center">' + target + ' g</div>' +
      '<div></div>' +
      '<div></div>' +
      '<div class="summary-cell center">' + actual + ' g</div>' +
      '<div></div>' +
    '</div>'
  );
}

function renderAllocationEditor(
  label,
  allocPicks,
  target,
  bottleCarbsForEditor,
  allocSwim,
  allocBike,
  allocRun
) {

    var inventory = GelInventory.flattenInventory();
  
var currentCarbs = allocPicks.reduce(function (s, p) {
  return s + p.carbs;
}, 0);

var delta = currentCarbs - target;

  function batchId() {
    return 'b-' + Math.random().toString(36).slice(2, 9);
  }

  function addNewGel(data) {
    var inventory = load();

    var id = gelId(data.name, data.carbsPerGel, data.caffeineMg);

    if (inventory.some(g => g.id === id)) {
      throw new Error('Gel already exists, add batch instead');
    }

    inventory.push({
      id: id,
      name: data.name,
      carbsPerGel: data.carbsPerGel,
      caffeineMg: data.caffeineMg || 0,
      batches: [{
        batchId: batchId(),
        expiry: data.expiry,
        quantity: data.quantity
      }]
    });

    save(inventory);
  }

  function addBatch(gelId, expiry, quantity) {
    var inventory = load();
    var gel = inventory.find(g => g.id === gelId);
    if (!gel) return;

    gel.batches.push({
      batchId: batchId(),
      expiry: expiry,
      quantity: quantity
    });

    save(inventory);
  }

  function deduct(gelId, qty) {
    var inventory = load();
    var gel = inventory.find(g => g.id === gelId);
    if (!gel) return;

    gel.batches.sort(function (a, b) {
      return new Date(a.expiry) - new Date(b.expiry);
    });

    gel.batches.forEach(function (batch) {
      if (qty <= 0) return;
      var take = Math.min(batch.quantity, qty);
      batch.quantity -= take;
      qty -= take;
    });

    // remove empty batches
    gel.batches = gel.batches.filter(b => b.quantity > 0);

    // remove gel entirely if empty
    if (gel.batches.length === 0) {
      inventory = inventory.filter(g => g.id !== gelId);
    }

    save(inventory);
  }

  function increase(gelId, qty) {
    var inventory = load();
    var gel = inventory.find(g => g.id === gelId);
    if (!gel) return;

    gel.batches.sort(function (a, b) {
      return new Date(b.expiry) - new Date(a.expiry);
    });

    gel.batches[0].quantity += qty;
    save(inventory);
  }

  function flatten() {
    var inventory = load();
    var units = [];

    inventory.forEach(function (gel) {
      gel.batches.forEach(function (batch) {
        for (var i = 0; i < batch.quantity; i++) {
          units.push({
            id: gel.id,
            name: gel.name,
            carbs: gel.carbsPerGel,
            caffeineMg: gel.caffeineMg || 0,
            expiry: batch.expiry
          });
        }
      });
    });

    return units;
  }

  function deductPlan(picks) {
    var grouped = {};
    picks.forEach(function (p) {
      grouped[p.id] = (grouped[p.id] || 0) + 1;
    });

    Object.keys(grouped).forEach(function (gelId) {
      deduct(gelId, grouped[gelId]);
    });
  }

  // Count allocated picks for this discipline by gel id
  var allocated = {};
  allocPicks.forEach(function (p) {
    allocated[p.id] = (allocated[p.id] || 0) + 1;
  });

function countAvailable(id, totalQty) {

  // build effective allocation:
  // all disciplines, but THIS one uses draftPicks
  var effectivePicks = []
    .concat(
      label === 'Swim' ? draftPicks : allocSwim.picks,
      label === 'Bike' ? draftPicks : allocBike.picks,
      label === 'Run'  ? draftPicks : allocRun.picks
    );

  // count how many are already used (including draft)
  var usedTotalEffective = effectivePicks.filter(function (p) {
    return p.id === id;
  }).length;

  return Math.max(0, totalQty - usedTotalEffective);
}

var rows = inventory.map(function (g) {

  var allocQty = allocated[g.id] || 0;
  
var totalQty = inventory.filter(function (x) {
  return x.id === g.id;
}).length;

var available = countAvailable(g.id, totalQty);

  return (
    '<div class="editor-row" ' +
      'style="display:grid; grid-template-columns: 2fr 1fr 1.5fr; gap:8px; align-items:center; margin:4px 0;">' +

      '<div>' +
g.name + ' (' + g.carbs + ' g)' +
      '</div>' +

      '<div class="summary-cell center">' +
        available +
      '</div>' +

      '<div class="summary-cell center">' +
        '<button class="ghost editor-minus" data-id="' + g.id + '">−</button> ' +
        '<span style="display:inline-block; min-width:24px; text-align:center;">' +
          allocQty +
        '</span> ' +
        '<button class="ghost editor-plus" data-id="' + g.id + '"' +
          (available === 0 ? ' disabled' : '') +
        '>+</button>' +
      '</div>' +

    '</div>'
  );

                         
}).join('');

  return (
    '<div class="allocation-editor" ' +
         'style="padding:12px; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px;">' +

      '<h4 style="margin:0 0 8px 0;">Edit ' + label + ' allocation</h4>' +

'<div style="margin:6px 0 10px 0; font-size:0.9rem;">' +

'<strong>Target:</strong> ' + Math.round(target) + ' g · ' +
'<strong>Current:</strong> ' + Math.round(currentCarbs) + ' g · ' +
'<strong>Δ:</strong> ' +
(delta > 0 ? '+' : '') + Math.round(delta) + ' g' +
'</div>' +

      '<div style="font-size:0.85rem; color:#64748b; margin-bottom:8px;">' +
        '<strong>Inventory</strong> / <strong>Allocated</strong>' +
      '</div>' +

      rows +

      '<div style="display:flex; gap:8px; margin-top:12px;">' +
        '<button class="ghost editor-cancel">Cancel</button>' +
        '<button class="ghost editor-save">Save</button>' +
      '</div>' +

    '</div>'
  );
}

function wireAllocationEditor(discipline, allocSwim, allocBike, allocRun) {
  var inventory = GelInventory.flattenInventory();

  function getAllocContainer() {
    return draftPicks;
  }

  function countUsedAcrossAll(id) {
    return []
      .concat(allocSwim.picks, allocBike.picks, allocRun.picks)
      .filter(function (p) {
        return p.id === id;
      }).length;
  }

  // PLUS buttons
  document.querySelectorAll('.editor-plus').forEach(function (btn) {
    btn.onclick = function () {
      var id = this.dataset.id;
      var gel = inventory.find(function (g) { return g.id === id; });
      if (!gel) return;

var usedElsewhere = []
  .concat(allocSwim.picks, allocBike.picks, allocRun.picks)
  .filter(p => p.id === id && !draftPicks.includes(p))
  .length;

var usedHere = draftPicks.filter(p => p.id === id).length;

var availableQty = inventory.filter(function (x) {
  return x.id === id;
}).length;

if (usedElsewhere + usedHere >= availableQty) return;

      
draftPicks.push({
  id: gel.id,
  name: gel.name,
  carbs: gel.carbs,
  used: 1
});
      
      calculateAndShowSummary();
    };
  });

  // MINUS buttons
  document.querySelectorAll('.editor-minus').forEach(function (btn) {
    btn.onclick = function () {
      var id = this.dataset.id;
      var idx = draftPicks.findIndex(function (p) {
        return p.id === id;
      });
      if (idx === -1) return;

      draftPicks.splice(idx, 1);
      calculateAndShowSummary();
    };
  });

  // CANCEL
  var cancelBtn = document.querySelector('.editor-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = function () {
      activeEditDiscipline = null;
      draftPicks = null;
      calculateAndShowSummary();
    };
  }

  // SAVE
  var saveBtn = document.querySelector('.editor-save');
  if (saveBtn) {
    saveBtn.onclick = function () {
     
manualOverrides[discipline] = draftPicks.map(function (p) {
  return Object.assign({}, p);
});
activeEditDiscipline = null;
draftPicks = null;
calculateAndShowSummary();

    };
  }
}
  
function renderOverview(
  swimH,
  bikeH,
  runH,
  allocSwim,
  allocBike,
  allocRun,
  bottleCarbs,
  targetTotal,
  actualTotal
) {
  var totalHours = round(swimH + bikeH + runH, 2);

  var allGels = []
    .concat(allocSwim.picks, allocBike.picks, allocRun.picks);

  var byName = {};
  allGels.forEach(function (g) {
    if (!byName[g.name]) {
      byName[g.name] = { count: 0, carbs: 0 };
    }
    byName[g.name].count += 1;
    byName[g.name].carbs += g.carbs;
  });

  var gelList = Object.keys(byName).map(function (name) {
    var g = byName[name];
    return (
      '<li>' + name + ': ' +
      g.count + ' gel' + (g.count > 1 ? 's' : '') +
      ' (' + Math.round(g.carbs) + ' g)</li>'
    );
  }).join('');

  var html =
    '<div class="summary-overview">' +
      '<h3>Plan overview</h3>' +
      '<p><strong>Total duration:</strong> ' + totalHours + ' h</p>' +
      (gelList
        ? '<p><strong>Total gels:</strong></p><ul>' + gelList + '</ul>'
        : ''
      );

  if (bottleCarbs > 0) {
    html +=
   '<p><strong>Total bottles:</strong> ' + Math.round(bottleCarbs) + ' g</p>';
  }

  html +=
      '<p><strong>Target:</strong> ' + targetTotal + ' g</p>' +
      '<p><strong>Actual:</strong> ' + actualTotal + ' g</p>' +
      '<p><strong>Difference:</strong> ' +
        (actualTotal - targetTotal > 0 ? '+' : '') +
        (actualTotal - targetTotal) + ' g</p>' +
    '</div>';

  return html;
}

  /* -----------------------------
     MAIN CALCULATION
  ------------------------------ */
 
function calculateAndShowSummary() {

  // ✅ Open UI immediately
  $('overlay').classList.add('show');
  console.log('✅ Overlay opened');

  // ⬇️ Everything below is allowed to fail without hiding the UI

  var swimHours = minutesToHours('swimMinutes');
  var bikeHours = minutesToHours('bikeMinutes');
  var runHours  = minutesToHours('runMinutes');

  // ... rest of logic


    var swimCPH = Number($('swimCPH').value) || 0;
    var bikeCPH = Number($('bikeCPH').value) || 0;
    var runCPH  = Number($('runCPH').value)  || 0;

    var numBottles     = Number($('numCarbBottles').value) || 0;
    var maxBottleCarbs = Number($('maxBottleCarbs').value) || 0;

    var preferLarge = $('bikePreferLarge').checked;
    var runMaxGel   = Number($('runMaxGel').value) || 30;

    var expiryInput = Number($('expiryHorizonDays').value);
    var totalInventory = GelInventory.flattenInventory()
      .reduce(function (s, g) { return s + (g.quantity || 0); }, 0);

    var expiryHorizon = (expiryInput > 0) ? expiryInput : totalInventory;

    var swimTarget = swimHours * swimCPH;
    var bikeTarget = bikeHours * bikeCPH;
    var runTarget  = runHours * runCPH;

    var bikeBottleCarbs = Math.min(bikeTarget, numBottles * maxBottleCarbs);
    var bikeGelTarget   = Math.max(0, bikeTarget - bikeBottleCarbs);
  
// Total carbs from bottles (known upfront)
var bottleCarbsTotal = Math.round(bikeBottleCarbs);


// ===============================
// 🔁 GLOBAL PROGRESSIVE ALLOCATION
// ===============================

// Discipline targets (gels only)
var targets = {
  swim: swimTarget,
  run:  runTarget,
  bike: bikeGelTarget
};

// Remaining carbs needed
var remaining = {
  swim: swimTarget,
  run:  runTarget,
  bike: bikeGelTarget
};

var totalTarget = swimTarget + bikeGelTarget + runTarget;
var currentTotal = 0;

// Load inventory as INDIVIDUAL gel units
var inventory = GelInventory.flattenInventory();
var gels = [];

inventory.forEach(function (item) {
  gels.push({
    id: item.id,
    name: item.name,
    carbs: item.carbs,
    expiry: item.expiry,
    caffeineMg: item.caffeineMg || 0,
    used: 1
  });
});

// Result buckets
var allocSwim = { picks: [] };
var allocRun  = { picks: [] };
var allocBike = { picks: [] };

// Helper: discipline preference multiplier

function preferenceBoost(discipline, gel) {
  var boost = 1.0;

  // Discipline size preferences
  if (discipline === 'bike' && gel.carbs >= 35) {
    boost *= 1.25;
  }

  if (discipline === 'run' && gel.carbs >= 25 && gel.carbs <= 35) {
    boost *= 1.15;
  }

  // Expiry preference (soft, never forced)
  if (gel.expiry) {
    var days = Math.ceil((new Date(gel.expiry) - new Date()) / (1000 * 60 * 60 * 24));
    if (!isNaN(days) && days <= 30) {
      boost *= 1.2;
    }
  }

  return boost;
}

// Helper: benefit of assigning gel to discipline
function disciplineBenefit(rem, gel) {
  return Math.abs(rem) - Math.abs(rem - gel.carbs);
}

// Helper: global stop rule
function violatesGlobalRule(nextTotal) {
  var overshoot = nextTotal - totalTarget;
  var undershoot = totalTarget - nextTotal;

  if (overshoot <= 0) return false; // still undershooting
  if (undershoot <= 0) return false; // exact or perfect
  return overshoot >= 2 * undershoot;
}

// Progressive allocation
  
var safety = 0;
var MAX_ITERATIONS = 1000;


while (gels.length && safety < MAX_ITERATIONS) {
  safety++;
  var best = null;

  gels.forEach(function (gel, gi) {
    ['swim', 'run', 'bike'].forEach(function (d) {
      var benefit =
        disciplineBenefit(remaining[d], gel) *
        preferenceBoost(d, gel);

      if (benefit <= 0) return;

      var nextTotal = currentTotal + gel.carbs;
      if (violatesGlobalRule(nextTotal)) return;

      if (!best || benefit > best.benefit) {
        best = {
          index: gi,
          gel: gel,
          discipline: d,
          benefit: benefit
        };
      }
    });
  });

  if (!best) break;

  // Apply best assignment
  gels.splice(best.index, 1);
  currentTotal += best.gel.carbs;
  remaining[best.discipline] -= best.gel.carbs;

  if (best.discipline === 'swim') allocSwim.picks.push(best.gel);
  if (best.discipline === 'run')  allocRun.picks.push(best.gel);
  if (best.discipline === 'bike') allocBike.picks.push(best.gel);
}
  
// ---- DEBUG: allocation observability (Step 1) ----
function sumCarbs(picks) {
  return picks.reduce(function (s, p) {
    return s + p.carbs;
  }, 0);
}

console.log('--- Allocation debug ---');
console.log('Swim target:', swimTarget, 'allocated carbs:', sumCarbs(allocSwim.picks));
console.log('Bike target:', bikeGelTarget, 'allocated carbs:', sumCarbs(allocBike.picks));
console.log('Run target:', runTarget, 'allocated carbs:', sumCarbs(allocRun.picks));
console.log(
  'TOTAL allocated gel carbs:',
  sumCarbs(
    [].concat(allocSwim.picks, allocBike.picks, allocRun.picks)
  )
);
console.log('------------------------');

// ---- Totals summary ----

// ---- Total target carbs ----
var targetCarbsTotal = Math.round(
  swimTarget + bikeTarget + runTarget
);

// ---- Apply manual overrides if present ----
if (manualOverrides.Swim) {
  allocSwim.picks = manualOverrides.Swim.map(function (p) {
    return Object.assign({}, p);
  });
}
if (manualOverrides.Bike) {
  allocBike.picks = manualOverrides.Bike.map(function (p) {
    return Object.assign({}, p);
  });
}
if (manualOverrides.Run) {
  allocRun.picks = manualOverrides.Run.map(function (p) {
    return Object.assign({}, p);
  });
}

// ---- Totals summary (AFTER overrides) ----

// Total carbs from gels (FINAL plan)
var gelCarbsTotal = Math.round(
  allocSwim.picks
    .concat(allocBike.picks, allocRun.picks)
    .reduce(function (sum, p) {
      return sum + p.carbs;
    }, 0)
);

// ---- Total actual carbs (packed) ----
var actualCarbsTotal = bottleCarbsTotal + gelCarbsTotal;

// Difference (positive = surplus, negative = shortage)
var carbDelta = actualCarbsTotal - targetCarbsTotal;

$('sSummary').innerHTML =
  renderSummaryHeader() +
  renderSummaryRow('Swim', swimHours, swimTarget, allocSwim.picks, 0) +
  renderSummaryRow('Bike', bikeHours, bikeTarget, allocBike.picks, bikeBottleCarbs) +
  renderSummaryRow('Run',  runHours,  runTarget,  allocRun.picks, 0);

$('sSummaryTotal').innerHTML =
  renderSummaryTotalRow(targetCarbsTotal, actualCarbsTotal);

if (activeEditDiscipline && draftPicks) {
  var editorHtml =
    renderAllocationEditor(
      activeEditDiscipline,
      draftPicks,
      activeEditDiscipline === 'Swim' ? swimTarget :
      activeEditDiscipline === 'Bike' ? bikeTarget :
      runTarget,
      activeEditDiscipline === 'Bike' ? bikeBottleCarbs : 0,
      allocSwim,
      allocBike,
      allocRun
    );

  // inject editor directly below summary table
  $('sSummary').insertAdjacentHTML('beforeend',
    '<div class="inline-editor" style="margin: 6px 12px 12px;">' +
      editorHtml +
    '</div>'
  );
}
``

$('sOverview').innerHTML =
  renderOverview(
    swimHours,
    bikeHours,
    runHours,
    allocSwim,
    allocBike,
    allocRun,
    bikeBottleCarbs,
    targetCarbsTotal,
    actualCarbsTotal
  );

// ---- Wire allocation editor buttons (ONLY when editor is open) ----
if (activeEditDiscipline && draftPicks) {
  wireAllocationEditor(
    activeEditDiscipline,
    allocSwim,
    allocBike,
    allocRun
  );
}

// ---- Wire edit buttons ----
document.querySelectorAll('.edit-btn').forEach(function (btn) {
  btn.onclick = function () {
  
activeEditDiscipline = this.dataset.discipline;

var alloc =
  activeEditDiscipline === 'Swim' ? allocSwim :
  activeEditDiscipline === 'Bike' ? allocBike :
  allocRun;

// clone current picks into a draft
draftPicks = alloc.picks.map(function (p) {
  return Object.assign({}, p);
});

    calculateAndShowSummary(); // re-render with editor visible
  };
});

// Write totals into summary row

var deltaLabel = carbDelta === 0
  ? 'exact match'
  : (carbDelta > 0
      ? '+' + carbDelta + ' g'
      : carbDelta + ' g');

// Copy summary to clipboard

var btnCopy = document.getElementById('btnCopySummary');
if (btnCopy) {
  btnCopy.onclick = function () {
    var text =
      $('sSummary').innerText + '\n\n' +
      $('sSummaryTotal').innerText + '\n\n' +
      $('sOverview').innerText;

    navigator.clipboard.writeText(text);
  };
}

    function list(title, alloc) {
      if (!alloc.picks.length) {
        return '<h3>' + title + '</h3><p>None</p>';
      }

      var items = alloc.picks.map(function (p) {
        return '<li>' + p.used + ' × ' + p.name + ' (' + p.carbs + ' g)</li>';
      }).join('');

      return '<h3>' + title + '</h3><ul>' + items + '</ul>';
    }

    $('sInv').innerHTML =
      list('Swim gels', allocSwim) +
      list('Bike gels', allocBike) +
      list('Run gels',  allocRun) +
      '<button id="btnDeduct" class="ghost">Mark as packed</button>';

    var btnDeduct = $('btnDeduct');
    if (btnDeduct) {
      btnDeduct.onclick = function () {
        var all = [].concat(allocSwim.picks, allocBike.picks, allocRun.picks);
        GelInventory.deductPlanFromInventory(all);
        GelInventory.renderTable();
        alert('Inventory updated');
        document.getElementById('overlay').classList.remove('show');
      };
    }
  }

  

document.addEventListener('DOMContentLoaded', function () {

  var btnCalc = document.getElementById('btnCalc');
  if (!btnCalc) {
    console.warn('btnCalc not found');
    return;
  }

  btnCalc.addEventListener('click', function () {
    console.log('✅ Calculate clicked');
    calculateAndShowSummary();
  });

  var closeBtn = document.getElementById('close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      document.getElementById('overlay').classList.remove('show');
    });
  }

});
})();
