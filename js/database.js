function fbPath(hq,cat){
  return hq.replace(/\s/g,"_").replace(/[.#$\[\]]/g,"_")+"/"+cat.replace(/\s/g,"_").replace(/[.#$\[\]]/g,"_");
}

// ── FORMAT NORMALIZER: server से आई लिस्ट को हमेशा एक जैसा array बनाओ ──
// पुराना ढांचा: array | नया (आने वाला) per-record ढांचा: object {IVRS: record}
// नए ढांचे में हर record का 'o' field उसका क्रम बताएगा — उसी से order बहाल होता है
// चरण 3 (per-record migration) में सिर्फ लिखने वाला code बदलेगा — पढ़ना यहीं से दोनों संभालता है
function normList(d){
  if(!d) return [];
  var arr=Array.isArray(d)?d.filter(Boolean):Object.keys(d).map(function(k){return d[k];}).filter(Boolean);
  arr=arr.map(migrateRemarks);
  var hasO=false;
  for(var i=0;i<arr.length;i++){ if(arr[i]&&arr[i].o!=null){hasO=true;break;} }
  if(hasO) arr.sort(function(a,b){return (Number(a&&a.o)||0)-(Number(b&&b.o)||0);});
  return arr;
}

function fbGet(hq,cat,cb){
  var cached=cGet(hq,cat);
  // pending offline बदलाव हैं तो server data से overwrite मत करो — पहले sync
  if(isPending(hq,cat)){
    cb(cached);
    if(navigator.onLine) flushPending();
    return;
  }
  if(cached.length){
    cb(cached); // तुरंत cache से दिखाएं — fast!
    // background silent refresh
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        var data=normList(d);
        overlayOps(hq,cat,data);
        var changed=JSON.stringify(data)!==JSON.stringify(cached);
        cSet(hq,cat,data);
        if(changed) cb(data);
        setSyncStatus(true);
      }).catch(function(){setSyncStatus(false);});
    return;
  }
  // Cache empty — network से load
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      var data=normList(d);
      overlayOps(hq,cat,data);
      cSet(hq,cat,data);
      cb(data);
      setSyncStatus(true);
    })
    .catch(function(){
      cb([]);
      setSyncStatus(false);
    });
}

function fbSet(hq,cat,arr,cb){
  var prev=cGet(hq,cat)||[];
  cSet(hq,cat,arr);
  if(arr.length>200){
    toast("⏳ "+arr.length+" records सेव हो रहे हैं...","inf");
  }
  if(isMigrated(hq,cat)) _fbPutPerRecord(hq,cat,prev,arr,cb);
  else _fbPut(hq,cat,arr,cb);
}

function _fbPut(hq,cat,arr,cb){
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(arr)
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat); // ऑनलाइन होते हुए save fail — असली गड़बड़
    markPending(hq,cat,"put");
    setSyncStatus(false);
    toast("📴 ऑफलाइन — बदलाव device पर save है, नेट आते ही अपने आप sync होगा","inf");
    if(cb) cb(false);
  });
}

// migrated (per-record) HQ/श्रेणी के लिए — prev/arr में जो record बदले/जुड़े/हटे हों सिर्फ उन्हें PATCH करना,
// पूरी लिस्ट दोबारा नहीं भेजना (bandwidth बचत + concurrent-edit टकराव खत्म)
// किसी record में acc न हो तो null लौटाएं — caller पुराने सुरक्षित array-PUT पर वापस जाए
function _diffToPatch(prev,arr){
  for(var i=0;i<arr.length;i++){
    var x=arr[i];
    if(!x||x.acc==null||String(x.acc).trim()==="") return null;
  }
  var prevByAcc={};
  (prev||[]).forEach(function(x){ if(x&&x.acc!=null) prevByAcc[String(x.acc)]=x; });
  var maxO=-1;
  (prev||[]).forEach(function(x){ if(x&&x.o!=null&&Number(x.o)>maxO) maxO=Number(x.o); });
  var patch={},changed=false,nextO=maxO+1,newAccSet={};
  arr.forEach(function(x){
    var k=String(x.acc);
    newAccSet[k]=1;
    if(x.o==null) x.o=nextO++; // नया record — मौजूदा क्रम के आखिर में जुड़े
    var old=prevByAcc[k];
    if(!old||JSON.stringify(old)!==JSON.stringify(x)){ patch[k]=x; changed=true; }
  });
  Object.keys(prevByAcc).forEach(function(k){
    if(!newAccSet[k]){ patch[k]=null; changed=true; } // हटाया गया record — PATCH में null = delete
  });
  return changed?patch:{};
}

function _fbPutPerRecord(hq,cat,prev,arr,cb){
  var patch=_diffToPatch(prev,arr);
  if(patch===null){
    logErr("mig-noacc-fallback","record बिना acc मिला — सुरक्षा के लिए पूरी लिस्ट (array) से सेव किया",hq+"/"+cat);
    _fbPut(hq,cat,arr,cb);
    return;
  }
  if(!Object.keys(patch).length){ if(cb) cb(true); return; } // कुछ बदला ही नहीं — network call भी नहीं
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PATCH",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(patch)
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat);
    markPending(hq,cat,"put",patch);
    setSyncStatus(false);
    toast("📴 ऑफलाइन — बदलाव device पर save है, नेट आते ही अपने आप sync होगा","inf");
    if(cb) cb(false);
  });
}

function fbDel(hq,cat,cb){
  // हटाने से पहले paid records का backup — ताकि "हटाएं → अपलोड" में वसूली न उड़े
  try{
    var old=cGet(hq,cat)||[],bk={};
    old.forEach(function(e){
      if(e&&e.acc&&e.status==="paid")bk[String(e.acc).trim()]={paydate:e.paydate||"",by:e.updatedBy||"",at:e.updatedAt||"",ts:e.ts||0,remarksArr:e.remarksArr||[]};
    });
    if(Object.keys(bk).length)localStorage.setItem("vt_paidbk_"+cKey(hq,cat),JSON.stringify({t:Date.now(),m:bk}));
  }catch(e){}
  cSet(hq,cat,[]);
  fetch(FB+"/"+fbPath(hq,cat)+".json",{method:"DELETE"})
    .then(function(r){if(!r.ok)throw 0;clearPendingKey(cKey(hq,cat));if(cb)cb();})
    .catch(function(e){if(navigator.onLine)logErr("delete-fail",e,hq+"/"+cat);markPending(hq,cat,"del");toast("📴 ऑफलाइन — नेट आने पर लिस्ट सभी के लिए हटेगी","inf");if(cb)cb();});
}

// Migrate old single-string remarks to array format
function migrateRemarks(x){
  if(!x) return x;
  if(!x.remarksArr){
    x.remarksArr = [];
    if(x.remarks && x.remarks.trim()){
      x.remarksArr.push({
        text: x.remarks.trim(),
        by: x.updatedBy || x.uploadedBy || "—",
        at: x.updatedAt || x.uploadedAt || ""
      });
    }
  }
  return x;
}

var catNamesTimer = null;
var liveSource = null; // real-time SSE stream (Firebase REST streaming)

function stopListen(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(liveSource){liveSource.close();liveSource=null;}
}

// SSE "put" event का data पार्स करना — Firebase पूरे node (path:"/") के बदलाव पर event में ही नया data दे देता है
// तभी {ok:true,data} लौटाएं ताकि caller दोबारा fetch न करे; कोई और path/parse-issue हो तो {ok:false} (caller safe fallback ले)
function _sseFullPutData(evData){
  try{
    var msg=JSON.parse(evData);
    if(msg&&msg.path==="/") return {ok:true,data:msg.data};
  }catch(e){}
  return {ok:false};
}

function startListen(hq,cat){
  stopListen();

  function applyIncoming(d){
    var data=normList(d);
    overlayOps(hq,cat,data);
    var prev=cGet(hq,cat);
    var changed=JSON.stringify(data)!==JSON.stringify(prev);
    cSet(hq,cat,data);
    if(changed){ // सिर्फ बदला हो तभी re-render
      renderSummaryWith(data);
      renderListWith(data);
    }
    setSyncStatus(true); updTime();
  }

  function pollOnce(){
    if(isPending(hq,cat)){if(navigator.onLine)flushPending();return;}
    fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(applyIncoming)
      .catch(function(){setSyncStatus(false);});
  }

  function startPolling(){
    if(pollTimer) return;
    pollOnce();
    pollTimer=setInterval(pollOnce,15000);
  }

  // असली real-time: Firebase REST streaming (Server-Sent Events) — बदलाव होते ही तुरंत मिलता है, हर 15 sec पूछने की ज़रूरत नहीं
  if(typeof EventSource==="function"){
    try{
      var url=FB+"/"+fbPath(hq,cat)+".json"+(ID_TOKEN?("?auth="+encodeURIComponent(ID_TOKEN)):"");
      var es=new EventSource(url);
      liveSource=es;
      // "put" event में Firebase पहले से पूरा नया data भेज देता है — उसी को इस्तेमाल करो,
      // दोबारा fetch करके एक ही data दो बार डाउनलोड मत करो (bandwidth बचत)
      es.addEventListener("put",function(ev){
        if(isPending(hq,cat))return;
        var r=_sseFullPutData(ev.data);
        if(r.ok){ applyIncoming(r.data); return; }
        pollOnce(); // सुरक्षित fallback
      });
      es.addEventListener("patch",function(){ if(!isPending(hq,cat)) pollOnce(); });
      es.onopen=function(){setSyncStatus(true);};
      es.onerror=function(){
        setSyncStatus(false);
        if(es.readyState===2){ // CLOSED — स्ट्रीम पूरी तरह टूट गई (जैसे auth fail), polling पर वापस जाओ
          if(liveSource===es) liveSource=null;
          startPolling();
        }
        // वरना EventSource खुद reconnect करने की कोशिश करता रहेगा
      };
      pollOnce(); // पहला data तुरंत दिखाएं
    }catch(e){
      startPolling();
    }
  } else {
    startPolling();
  }

  // हर 8 sec में CAT_NAMES check — JE का बदला नाम तुरंत दिखे; साथ ही MIGRATED flags भी ताज़ा रहें
  // (चरण 3 माइग्रेशन के दौरान/बाद हर device जल्दी सही write-path — array या per-record — अपनाए)
  if(catNamesTimer) clearInterval(catNamesTimer);
  catNamesTimer=setInterval(function(){
    fetchCatNamesFromFB(true);
    loadMigratedFlags();
  },8000);
}

