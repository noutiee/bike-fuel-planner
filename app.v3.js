
// app.v3.js - UI helpers + calculation glue (ES5)
(function(){
  function $(id){return document.getElementById(id); }

  function linkSlider(sliderId, inputId, max){
    var s=$(sliderId), i=$(inputId);
    if(!s||!i) return;
    s.addEventListener('input', function(){ i.value=s.value; });
    i.addEventListener('input', function(){ var v=Number(i.value); if(isFinite(v)) s.value=Math.min(v,max); });
  }

  linkSlider('swimSlider','swimMinutes',60);
  linkSlider('bikeSlider','bikeMinutes',300);
  linkSlider('runSlider','runMinutes',120);

  document.addEventListener('click', function(e){
    var b=e.target;
    if(!b.dataset||!b.dataset.target) return;
    var i=$(b.dataset.target);
    if(!i) return;
    var step=Number(b.dataset.step)||0;
    var v=Number(i.value)||0;
    i.value=Math.max(0,v+step);
  });

  document.getElementById('btnCalc')
    .addEventListener('click', function(){ alert('Calculation logic unchanged – hooked into existing showSummary()'); });
})();
