// ── ERROR LOG: हर गड़बड़ी का record — device (localStorage) पर + Firebase /LOGS में ──
// रोज़ के काम में कुछ नहीं बदलता; जिस दिन कुछ गलत हो, JE "एरर लॉग" (user menu) में वजह देख सकते हैं
var LOG_KEY="dc_logs3", LOG_MAX=100;
var _logPush=0, LOG_PUSH_MAX=50; // एक session में server पर ज़्यादा से ज़्यादा 50 entries — loop/spam से बचाव
var DEV_ID=(function(){
  try{
    var d=localStorage.getItem("dc_devid");
    if(!d){d=Date.now().toString(36)+Math.random().toString(36).slice(2,7);localStorage.setItem("dc_devid",d);}
    return d;
  }catch(e){return "unknown";}
})();

// ── DEVICE VERSION TRACKING: कौन सा device किस app version पर है, यह हमेशा पता रहे ──
// चरण 3 माइग्रेशन (per-record) से पहले/बाद यह पक्का करने के लिए ज़रूरी कि कोई device पुराने
// write-path वाले code पर न रह जाए (वरना वह migrated list को दोबारा array में लिख सकता है)
var deviceTimer=null;
function pingDeviceVersion(){
  if(!navigator.onLine||!CU)return;
  fetch(FB+"/DEVICE_VERSIONS/"+DEV_ID+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({v:APP_VER,hq:CU.hq,role:CU.role,name:CU.name,t:Date.now()})
  }).catch(function(){});
}
function startDevicePing(){
  pingDeviceVersion();
  if(deviceTimer) clearInterval(deviceTimer);
  // हर 4 घंटे दोबारा — जो device हफ्तों बंद न हो (सिर्फ background में पड़ा रहे), उसकी असली (शायद पुरानी) version भी पता चलती रहे
  deviceTimer=setInterval(pingDeviceVersion,4*60*60*1000);
}
function stopDevicePing(){
  if(deviceTimer){clearInterval(deviceTimer);deviceTimer=null;}
}

// ── DEVICE VERSION VIEWER (सिर्फ JE) — कौन से devices पुराने version पर हैं, साफ़ दिखे ──
function _dvRender(){
  var el=document.getElementById("mig-devices");
  if(!el)return;
  el.innerHTML="<div class='log-empty'>⏳ लोड हो रहा है...</div>";
  fetch(FB+"/DEVICE_VERSIONS.json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      var rows=[];
      if(d&&typeof d==="object") Object.keys(d).forEach(function(k){ if(d[k]) rows.push(d[k]); });
      if(!rows.length){ el.innerHTML="<div class='log-empty'>अभी तक कोई device record नहीं — यह नए version से अपने आप बनता है</div>"; return; }
      rows.sort(function(a,b){
        var aOld=a.v!==APP_VER, bOld=b.v!==APP_VER;
        if(aOld!==bOld) return aOld?-1:1; // पुराने version पहले दिखें
        return (b.t||0)-(a.t||0);
      });
      var anyOld=rows.some(function(r){return r.v!==APP_VER;});
      var html=anyOld
        ?"<div style='background:rgba(240,80,80,.08);border:1px solid rgba(240,80,80,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--red);font-weight:700;'>⚠️ कुछ devices अभी भी पुराने version पर हैं — माइग्रेट करने से पहले इन्हें अपडेट करवाएं</div>"
        :"<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--green);font-weight:700;'>✅ सभी दिखे devices v"+escHtml(APP_VER)+" पर हैं</div>";
      html+="<table class='wasc-table'><thead><tr><th>नाम</th><th>HQ</th><th>Version</th><th>आख़िरी बार</th></tr></thead><tbody>";
      rows.forEach(function(r){
        var old=r.v!==APP_VER;
        var when=r.t?new Date(r.t).toLocaleString("hi-IN"):"?";
        html+="<tr"+(old?" style='background:rgba(240,80,80,.06);'":"")+"><td class='wasc-hq'>"+escHtml(r.name||"?")+(r.role==="supervisor"?" (JE)":"")+"</td><td>"+escHtml(r.hq||"?")+"</td><td>"+(old?"⚠️ v":"✅ v")+escHtml(r.v||"?")+"</td><td>"+when+"</td></tr>";
      });
      html+="</tbody></table>";
      el.innerHTML=html;
    })
    .catch(function(){ el.innerHTML="<div class='log-empty'>लोड नहीं हो पाया — दोबारा कोशिश करें</div>"; });
}

function getLogs(){try{return JSON.parse(localStorage.getItem(LOG_KEY))||[];}catch(e){return [];}}

function logErr(ctx, err, extra){
  try{
    var m=!err?"":(err.message||String(err));
    var entry={
      t:new Date().toISOString(),
      v:(typeof APP_VER!=="undefined"?APP_VER:"?"),
      u:(typeof CU!=="undefined"&&CU)?(CU.role+"|"+CU.hq+"|"+CU.name):"(login से पहले)",
      d:DEV_ID,
      c:ctx||"",
      m:String(m).slice(0,300),
      x:extra?String(extra).slice(0,200):""
    };
    var logs=getLogs(); logs.push(entry);
    if(logs.length>LOG_MAX) logs=logs.slice(logs.length-LOG_MAX);
    try{localStorage.setItem(LOG_KEY,JSON.stringify(logs));}catch(e2){}
    // server push (fire & forget) — offline में skip; push fail होने पर दोबारा log नहीं (loop से बचाव)
    if(navigator.onLine && _logPush<LOG_PUSH_MAX && typeof FB!=="undefined"){
      _logPush++;
      var day=entry.t.slice(0,10);
      fetch(FB+"/LOGS/"+day+".json",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(entry)}).catch(function(){});
    }
  }catch(e3){}
}

// बिना पकड़ी गई हर JS error अपने आप log हो — सिवाय ब्राउज़र के जान-बूझकर छुपाई गई cross-origin
// "Script error." के (CDN लाइब्रेरी — Firebase/XLSX/PapaParse — के अंदर की error, ब्राउज़र सुरक्षा
// कारणों से filename/line/detail कुछ नहीं देता) — इसे लॉग करने से कभी कोई सुराग नहीं मिलता, सिर्फ़
// शोर बनता; असली (हमारे कोड की, same-origin) errors पहले जैसे ही पूरी जानकारी के साथ लॉग होती रहेंगी
window.addEventListener("error",function(ev){
  if(!ev) return;
  if(ev.message==="Script error."&&!ev.filename&&!ev.lineno&&!ev.error) return;
  if(ev.error||ev.message) logErr("js-error",ev.error||ev.message,(ev.filename||"").split("/").pop()+":"+(ev.lineno||""));
});
window.addEventListener("unhandledrejection",function(ev){
  logErr("promise",ev&&ev.reason);
});

// ── LOG VIEWER (सिर्फ JE) ──
function openLogModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE लॉग देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("log-overlay").classList.add("open");
  document.getElementById("log-local").innerHTML=logRowsHtml(getLogs().slice().reverse());
  document.getElementById("log-srv").innerHTML='<div class="log-empty">लोड हो रहा है...</div>';
  fetchServerLogs();
  cleanupOldServerLogs();
}
function closeLogModal(){document.getElementById("log-overlay").classList.remove("open");}
function closeLogOutside(e){if(e.target===document.getElementById("log-overlay"))closeLogModal();}

function logRowsHtml(arr){
  if(!arr||!arr.length) return '<div class="log-empty">कोई error नहीं — सब ठीक है ✅</div>';
  var h="";
  arr.slice(0,100).forEach(function(e){
    if(!e)return;
    var when=(e.t||"").replace("T"," ").slice(0,19);
    h+='<div class="log-row"><div class="log-top"><span class="log-ctx">'+escHtml(e.c||"?")+'</span>'
      +'<span class="log-when">'+escHtml(when)+' UTC</span></div>'
      +'<div class="log-msg">'+escHtml(e.m||"")+(e.x?' <span class="log-x">['+escHtml(e.x)+']</span>':'')+'</div>'
      +'<div class="log-who">'+escHtml(e.u||"?")+' • v'+escHtml(e.v||"?")+' • '+escHtml(e.d||"")+'</div></div>';
  });
  return h;
}

// आज + कल के logs — सभी devices से
function fetchServerLogs(){
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .catch(function(){return null;});
  })).then(function(res){
    var all=[];
    res.forEach(function(d){if(d&&typeof d==="object")Object.keys(d).forEach(function(k){all.push(d[k]);});});
    all.sort(function(a,b){return String(b&&b.t||"").localeCompare(String(a&&a.t||""));});
    document.getElementById("log-srv").innerHTML=all.length?logRowsHtml(all):'<div class="log-empty">पिछले 2 दिन में किसी device पर कोई error नहीं ✅</div>';
  });
}

// 15 दिन से पुराने server logs अपने आप हटें — free plan की जगह न भरे
function cleanupOldServerLogs(){
  fetch(FB+"/LOGS.json?shallow=true&t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d)return;
      var cutoff=new Date(Date.now()-15*86400000).toISOString().slice(0,10);
      Object.keys(d).forEach(function(day){
        if(day<cutoff) fetch(FB+"/LOGS/"+day+".json",{method:"DELETE"}).catch(function(){});
      });
    }).catch(function(){});
}

function clearLocalLogs(){
  try{localStorage.removeItem(LOG_KEY);}catch(e){}
  document.getElementById("log-local").innerHTML=logRowsHtml([]);
  toast("इस डिवाइस के लॉग साफ़ हो गए","ok");
}

// "सभी डिवाइस" वाला हिस्सा (fetchServerLogs) Firebase /LOGS/{day} से आता है — पहले सिर्फ़ 15 दिन
// बाद अपने आप साफ़ होता था (cleanupOldServerLogs), JE के पास मैन्युअल तरीका नहीं था, तो पुरानी/
// पहले ही देखी-समझी entries जमा होती रहतीं और हर बार लॉग खोलने पर वही ढेर दिखता रहता — असली bug यही था
function clearServerLogs(){
  if(!confirm("⚠️ यह सभी devices से दिख रहे पिछले 2 दिन के लॉग हमेशा के लिए मिटा देगा (सिर्फ़ इस device का लॉग नहीं — सबका)। जारी रखें?"))return;
  document.getElementById("log-srv").innerHTML='<div class="log-empty">साफ़ हो रहा है...</div>';
  var days=[0,1].map(function(off){return new Date(Date.now()-off*86400000).toISOString().slice(0,10);});
  Promise.all(days.map(function(day){
    return fetch(FB+"/LOGS/"+day+".json",{method:"DELETE"}).catch(function(){});
  })).then(function(){
    toast("🗑️ सभी devices के लॉग साफ़ हो गए","ok");
    fetchServerLogs();
  });
}
