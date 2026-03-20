
// app.v2.js - all inline JS moved here; ES5-only; ASCII-only
(function(){
  // SW registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){ navigator.serviceWorker.register('./sw.js', { scope: './' }); });
  }

  function $(id){ return document.getElementById(id); }

  function calc(){
    var rideHours=parseFloat($("rideHours").value)||0,
      cph=parseFloat($("carbsPerHour").value)||0,
      maxB=parseFloat($("maxBottleCarbs").value)||0,
      nB=parseFloat($("numCarbBottles").value)||0,
      G=parseFloat($("G").value)||0,
      F=parseFloat($("F").value)||0,
      maltoFrac=(parseFloat($("maltoFrac").value)||0)/100,
      fructoseFrac=(parseFloat($("fructoseFrac").value)||0)/100,
      NaPer=parseFloat($("sodiumPerScoop").value)||0,
      NaH=parseFloat($("targetSodiumPerHour").value)||0;
    var total = rideHours * cph;
    var inBottlesRaw = Math.min(nB*maxB, total);
    var parts = G+F;
    var fructoseCarbs = parts ? inBottlesRaw * F / parts : 0;
    var maltoCarbs    = parts ? inBottlesRaw * G / parts : 0;
    var fructosePowder = fructoseFrac ? fructoseCarbs / fructoseFrac : 0;
    var maltoPowder    = maltoFrac ? maltoCarbs / maltoFrac : 0;
    var totalSodium = rideHours * NaH;
    var scoops = NaPer ? totalSodium / NaPer : 0;
    return { rideHours:rideHours,cph:cph,nB:nB,maxB:maxB,G:G,F:F,maltoFrac:maltoFrac,fructoseFrac:fructoseFrac,NaPer:NaPer,NaH:NaH,total:total,inBottlesRaw:inBottlesRaw,gelsRequired: Math.max(0, total - inBottlesRaw), fructosePowder:fructosePowder,maltoPowder:maltoPowder,totalPowder: fructosePowder + maltoPowder,totalSodium: scoops*NaPer,scoops:scoops };
  }

  function round(x,d){var p=Math.pow(10,d||0);return (Math.round((x+Number.EPSILON)*p)/p).toFixed(d||0)}

  function buildBaseSummary(o, allocated, adjustedBottles) {
    var actual = adjustedBottles + allocated;
    var dev = o.total ? (100*(actual-o.total)/o.total) : 0;
    var lines = [
      'Ride duration: ' + round(o.rideHours,2) + ' h',
      'Carbs per hour: ' + round(o.cph,0) + ' g/h',
      'Carb bottles: ' + o.nB,
      'Malto (per bottle): ' + round(o.nB? o.maltoPowder/o.nB : 0,0) + ' g',
      'Fructose (per bottle): ' + round(o.nB? o.fructosePowder/o.nB : 0,0) + ' g',
      'Evolytes (per bottle): ' + round(o.nB? o.scoops/o.nB : 0,2) + ' scoops',
      'Total carbs per bottle: ' + round(o.nB? adjustedBottles/o.nB : 0,0) + ' g',
      'Total carbs (plan): ' + round(actual,0) + ' g',
      'Delta vs target: ' + round(dev,1) + '%'
    ];
    return lines.join('
');
  }

  function showSummary(){
    var o = calc();
    var swimHours = parseFloat($("swimHours").value) || 0;
    var swimPreCarbs = parseFloat($("swimPreCarbs").value) || 0;
    var runHours = parseFloat($("runHours").value) || 0;
    var runCPH   = parseFloat($("runCarbsPerHour").value) || 0;
    var runMax   = parseFloat($("runMaxGel").value) || 30;
    var preferLarge = $("bikePreferLarge").checked;
    var horizonDays = parseFloat($("expiryHorizonDays").value) || 60;

    var swim = { hours: swimHours, preCarbs: swimPreCarbs };
    var allocSwim = swim.preCarbs > 0 ? GelInventory.allocateFromInventory(swim.preCarbs, { sport: 'swim', expiryHorizonDays: horizonDays, scarcityProtect: true }) : { picks: [], shortage: 0 };

    var gelsNeededBike = Math.max(0, o.total - o.inBottlesRaw);
    var allocBike = GelInventory.allocateFromInventory(gelsNeededBike, { sport: 'bike', preferLarge: preferLarge, expiryHorizonDays: horizonDays, scarcityProtect: true });
    var allocatedBikeCarbs = (allocBike.picks||[]).reduce(function(s,p){return s+p.carbs;},0);
    var bikeSurplus = Math.max(0, allocatedBikeCarbs - gelsNeededBike);
    var adjustedBottleCarbs = Math.max(0, o.inBottlesRaw - bikeSurplus);

    var run = { hours: runHours, target: runHours * runCPH, cph: runCPH };
    var allocRun = GelInventory.allocateFromInventory(run.target, { sport: 'run', maxGelCarbs: runMax, expiryHorizonDays: horizonDays, scarcityProtect: true });

    var base = buildBaseSummary(o, allocatedBikeCarbs, adjustedBottleCarbs);

    var rows = [
      'Bike - ' + round(o.rideHours,2) + ' h, bottles: ' + round(o.rideHours ? adjustedBottleCarbs/o.rideHours : 0,0) + ' g/h, gels: ' + round(allocatedBikeCarbs,0) + ' g',
      'Swim - ' + round(swim.hours,2) + ' h, pre-carbs: ' + round(swim.preCarbs,0) + ' g',
      'Run - ' + round(run.hours,2) + ' h @ ' + round(run.cph,0) + ' g/h -> ' + round(run.target,0) + ' g',
      'Delta vs bike target: ' + round((o.total ? (100*((adjustedBottleCarbs + allocatedBikeCarbs)-o.total)/o.total) : 0),1) + '%',
      'Tap Copy to put this summary on your clipboard.'
    ];
    var ids=['s1','s2','s3','s4','s5'];
    for (var i=0;i<ids.length;i++){ var el=$(ids[i]); if(el){ el.textContent = rows[i] || ''; } }

    function toDMY(iso){ var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return iso; var y=m[1], mo=m[2], d=m[3]; return d + '/' + mo + '/' + y.slice(2); }
    function listHtml(title, alloc) {
      if (!alloc || !(alloc.picks||[]).length) return '<h3>'+title+'</h3><p>No gels allocated.</p>';
      var ul = (alloc.picks||[]).map(function(p){ return '<li>'+p.used+' x '+p.name+' (~'+p.carbs+' g, exp. '+toDMY(p.expiry)+')</li>'; }).join('');
      var shortage = (alloc.shortage > 0) ? '<p><strong>Shortage:</strong> '+alloc.shortage+' g still needed.</p>' : '<p>Fully covered</p>';
      return '<h3>'+title+'</h3><ul>'+ul+'</ul>'+shortage;
    }

    var invRow = $("sInv");
    if (invRow){
      invRow.innerHTML = listHtml('Swim - pre-carbs from inventory', allocSwim)
        + listHtml('Bike - gels from inventory', allocBike)
        + listHtml('Run - gels from inventory', allocRun)
        + '<button id="btnDeduct" class="ghost" type="button">Mark as packed (deduct all)</button>';
    }

    var btn = $("btnDeduct");
    if (btn){
      btn.addEventListener('click', function(){
        var picksAll = [];
        if (allocSwim && allocSwim.picks) { picksAll = picksAll.concat(allocSwim.picks); }
        if (allocBike && allocBike.picks) { picksAll = picksAll.concat(allocBike.picks); }
        if (allocRun && allocRun.picks)  { picksAll = picksAll.concat(allocRun.picks); }
        GelInventory.deductPlanFromInventory(picksAll);
        GelInventory.renderTable();
        alert('Inventory updated');
      });
    }

    var overlay = $("overlay"); if (overlay){ overlay.classList.add('show'); }

    var clip = base + '

' + 'Swim: ' + round(swim.hours,2) + ' h, pre-carbs: ' + round(swim.preCarbs,0) + ' g' + '
' + 'Run:  ' + round(run.hours,2) + ' h @ ' + round(run.cph,0) + ' g/h -> ' + round(run.target,0) + ' g' + '

' + 'Pack lists:';
    function toLines(alloc, title){ var t = '
'+title+':
'; if ((alloc.picks||[]).length) { t += alloc.picks.map(function(p){ return '- '+p.used+' x '+p.name+' (~'+p.carbs+' g, exp. '+toDMY(p.expiry)+')'; }).join('
'); if (alloc.shortage > 0) t += '
Shortage: '+alloc.shortage+' g'; } else { t += '- None'; } return t; }
    clip += toLines(allocSwim, 'Swim') + toLines(allocBike, 'Bike') + toLines(allocRun, 'Run');
    if (overlay){ overlay.dataset.summary = clip; }
  }

  var btnCalc=$("btnCalc"); if (btnCalc){ btnCalc.addEventListener('click', showSummary); }
  var btnClose=$("btnClose"); if (btnClose){ btnClose.addEventListener('click', function(){ var overlay=$("overlay"); if(overlay){ overlay.classList.remove('show'); } }); }
  var closeBtn=$("close"); if (closeBtn){ closeBtn.addEventListener('click', function(){ var overlay=$("overlay"); if(overlay){ overlay.classList.remove('show'); } }); }
  var btnCopy=$("btnCopy"); if (btnCopy){ btnCopy.addEventListener('click', function(){ var ov=$("overlay"); var t = (ov && ov.dataset ? ov.dataset.summary : '') || ''; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function(){ alert('Summary copied'); }).catch(fallback); } else { fallback(); } function fallback(){ var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); alert('Summary copied'); } catch(e){ alert('Copy failed. Long-press to select text.'); } document.body.removeChild(ta); } }); }
})();
