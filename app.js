
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

   //  var expiryHorizon = (expiryInput > 0) ? expiryInput : totalInventory;

    var swimTarget = swimHours * swimCPH;
    var bikeTarget = bikeHours * bikeCPH;
    var runTarget  = runHours * runCPH;

    var bikeBottleCarbs = Math.min(bikeTarget, numBottles * maxBottleCarbs);
    var bikeGelTarget   = Math.max(0, bikeTarget - bikeBottleCarbs);

// ---- GLOBAL gel target (shared inventory) ----
var totalGelTarget =
  swimTarget +
  bikeGelTarget +
  runTarget;

// ---- Build global gel units from inventory ----
var inventory = GelInventory.loadInventory();
var gelUnits = [];

inventory.forEach(function (item) {
  if (!item.carbs || !item.quantity) return;

  for (var i = 0; i < item.quantity; i++) {
    gelUnits.push({
      name: item.name,
      carbs: item.carbs
    });
  }
});
  
// ---- Global greedy gel allocation ----
gelUnits.sort(function (a, b) {
  return b.carbs - a.carbs;
});

var allocatedGels = [];
var allocatedGelCarbs = 0;

gelUnits.forEach(function (gel) {
  if (allocatedGelCarbs + gel.carbs <= totalGelTarget) {
    allocatedGels.push(gel);
    allocatedGelCarbs += gel.carbs;
  }
});

// ---- Optional: allow one gel overshoot if closer to target ----
var remaining = gelUnits.filter(function (g) {
  return allocatedGels.indexOf(g) === -1;
});

if (remaining.length) {
  var smallest = remaining[remaining.length - 1];
 
if (
  allocatedGelCarbs < totalGelTarget &&
  Math.abs(totalGelTarget - (allocatedGelCarbs + smallest.carbs)) <
  Math.abs(totalGelTarget - allocatedGelCarbs)
) {
    allocatedGels.push(smallest);
    allocatedGelCarbs += smallest.carbs;
  }
}

function takeGels(target, shared) {
  var picked = [];
  var sum = 0;

  while (shared.length && sum < target) {
    picked.push(shared.shift());
    sum += picked[picked.length - 1].carbs;
  }
  return picked;
}

// ---- Split allocated gels across disciplines ----
var remainingGels = allocatedGels.slice();


var bikeGels = takeGels(bikeGelTarget, remainingGels);
var runGels  = takeGels(runTarget, remainingGels);
var swimGels = takeGels(swimTarget, remainingGels);

    $('s1').textContent = 'Swim: ' + round(swimHours, 2) + ' h → ' + round(swimTarget, 0) + ' g';
    $('s2').textContent = 'Bike: ' + round(bikeHours, 2) + ' h → ' + round(bikeBottleCarbs, 0) + ' g bottles + ' + round(bikeGelTarget, 0) + ' g gels';
    $('s3').textContent = 'Run: '  + round(runHours, 2) + ' h → ' + round(runTarget, 0) + ' g';
  
// ---- Totals summary ----

// Total carbs from bottles (already known)
var bottleCarbsTotal = Math.round(bikeBottleCarbs);

// Total carbs from gels (from inventory allocation)
  
var gelCarbsTotal = Math.round(allocatedGelCarbs);

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

function listGels(title, gels) {
  if (!gels.length) {
    return '<h3>' + title + '</h3><p>None</p>';
  }

  var items = gels.map(function (g) {
    return '<li>' + g.name + ' (' + g.carbs + ' g)</li>';
  }).join('');

  return '<h3>' + title + '</h3><ul>' + items + '</ul>';
}

$('sInv').innerHTML =
  listGels('Swim gels', swimGels) +
  listGels('Bike gels', bikeGels) +
  listGels('Run gels',  runGels) +
  '<button id="btnDeduct" class="ghost">Mark as packed</button>';


    var btnDeduct = $('btnDeduct');
    if (btnDeduct) {
      btnDeduct.onclick = function () {
        var all = [].concat(swimGels, bikeGels, runGels);
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
