
// app.js – Main application logic (UI + calculation + summary)
// ES5 compatible, NO HTML entities

(function () {
  function $(id) { return document.getElementById(id); }

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
    var totalInventory = GelInventory.loadInventory()
      .reduce(function (s, g) { return s + (g.quantity || 0); }, 0);

    var expiryHorizon = (expiryInput > 0) ? expiryInput : totalInventory;

    var swimTarget = swimHours * swimCPH;
    var bikeTarget = bikeHours * bikeCPH;
    var runTarget  = runHours * runCPH;

    var bikeBottleCarbs = Math.min(bikeTarget, numBottles * maxBottleCarbs);
    var bikeGelTarget   = Math.max(0, bikeTarget - bikeBottleCarbs);


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
var inventory = GelInventory.loadInventory();
var gels = [];

inventory.forEach(function (item) {
  if (!item.quantity || !item.carbsPerGel) return;


var perGel = item.carbsPerGel;

for (var i = 0; i < item.quantity; i++) {
  gels.push({
    id: item.id,
    name: item.name,
    carbs: perGel,
    expiry: item.expiry,      // ISO string
    caffeineMg: item.caffeineMg || 0,
    used: 1
  });
}
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
  
    $('s1').textContent = 'Swim: ' + round(swimHours, 2) + ' h → ' + round(swimTarget, 0) + ' g';
    $('s2').textContent = 'Bike: ' + round(bikeHours, 2) + ' h → ' + round(bikeBottleCarbs, 0) + ' g bottles + ' + round(bikeGelTarget, 0) + ' g gels';
    $('s3').textContent = 'Run: '  + round(runHours, 2) + ' h → ' + round(runTarget, 0) + ' g';
  
// ---- Totals summary ----

// Total carbs from bottles (already known)
var bottleCarbsTotal = Math.round(bikeBottleCarbs);

// Total carbs from gels (from inventory allocation)
var gelCarbsTotal = Math.round(
  allocSwim.picks
    .concat(allocBike.picks, allocRun.picks)
    .reduce(function (sum, p) {
      return sum + p.carbs;
    }, 0)
);

// ---- Total target carbs ----
var targetCarbsTotal = Math.round(
  swimTarget + bikeTarget + runTarget
);

// ---- Total actual carbs (packed) ----
var actualCarbsTotal = bottleCarbsTotal + gelCarbsTotal;

// Difference (positive = surplus, negative = shortage)
var carbDelta = actualCarbsTotal - targetCarbsTotal;

// Write totals into summary row

var deltaLabel = carbDelta === 0
  ? 'exact match'
  : (carbDelta > 0
      ? '+' + carbDelta + ' g'
      : carbDelta + ' g');

$('s4').textContent =
  'Target vs actual: ' +
  targetCarbsTotal + ' g target → ' +
  actualCarbsTotal + ' g packed (' +
  deltaLabel + ')';

$('s5').innerHTML =
  '<button class="ghost" id="btnCopySummary">Copy summary</button>';


// Copy summary to clipboard
document.getElementById('btnCopySummary').onclick = function () {
  var text =
    $('s1').innerText + '\n' +
    $('s2').innerText + '\n' +
    $('s3').innerText + '\n' +
    $('s4').innerText;

  navigator.clipboard.writeText(text);
};


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
