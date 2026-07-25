// ── OFFLINE STORAGE: data device पर save रहता है, बिना नेट भी app पूरा चलता है ──
var LS_PREFIX="dc_cache3_";
function cKey(hq,cat){return hq+"_"+cat;}
function cGet(hq,cat){
  var k=cKey(hq,cat);
  if(CACHE[k]===undefined){
    try{var s=localStorage.getItem(LS_PREFIX+k);CACHE[k]=s?JSON.parse(s).map(migrateRemarks):[];}catch(e){CACHE[k]=[];}
  }
  return CACHE[k]||[];
}
function cSet(hq,cat,d){
  var k=cKey(hq,cat);
  CACHE[k]=d;
  try{localStorage.setItem(LS_PREFIX+k,JSON.stringify(d));}catch(e){}
}

// ── OFFLINE SYNC QUEUE: offline बदलाव queue में, नेट आते ही अपने आप Firebase sync ──
var PENDING_KEY="dc_pending3";
function getPending(){try{return JSON.parse(localStorage.getItem(PENDING_KEY))||{};}catch(e){return {};}}
function setPendingObj(p){try{localStorage.setItem(PENDING_KEY,JSON.stringify(p));}catch(e){}}
// patch दिया हो (migrated HQ/श्रेणी की per-record बचत) तो पहले से पेंडिंग patch के साथ जोड़ें —
// ताकि नेट आने पर सिर्फ असल बदले records ही PATCH हों, पूरी लिस्ट नहीं
function markPending(hq,cat,type,patch){
  var p=getPending();
  var k=cKey(hq,cat);
  var entry=p[k]||{hq:hq,cat:cat,type:type||"put"};
  entry.type=type||entry.type;
  if(patch){
    entry.patch=entry.patch||{};
    Object.keys(patch).forEach(function(pk){ entry.patch[pk]=patch[pk]; });
  }
  p[k]=entry;
  setPendingObj(p);
  setSyncStatus(navigator.onLine);
}
function clearPendingKey(k){var p=getPending();delete p[k];setPendingObj(p);}
function pendingCount(){return Object.keys(getPending()).length;}
function isPending(hq,cat){return !!getPending()[cKey(hq,cat)];}

// Record-level merge — दूसरों के बदलाव न मिटें
function rmkKeyOf(r){return (r.text||"")+"|"+(r.by||"")+"|"+(r.at||"");}
function mergeRecord(l,st){
  var base=((l.ts||0)>=(st.ts||0))?l:st;
  var out=JSON.parse(JSON.stringify(base));
  var seen={},arr=[];
  (st.remarksArr||[]).concat(l.remarksArr||[]).forEach(function(r){
    if(!r)return; var k=rmkKeyOf(r);
    if(!seen[k]){seen[k]=1;arr.push(r);}
  });
  out.remarksArr=arr;
  return out;
}
function mergeArrays(local,server){
  if(!server||!server.length) return local||[];
  if(!local||!local.length) return server;
  var sMap={};
  server.forEach(function(x){if(x&&x.acc)sMap[x.acc]=x;});
  var usedAcc={};
  var out=local.map(function(l){
    if(l&&l.acc&&sMap[l.acc]){usedAcc[l.acc]=1;return mergeRecord(l,sMap[l.acc]);}
    return l;
  });
  server.forEach(function(st){
    if(st&&st.acc&&!usedAcc[st.acc]) out.push(st);
  });
  return out;
}

var _flushing=false;
function flushPending(){
  if(_flushing||!navigator.onLine) return;
  var p=getPending();
  var keys=Object.keys(p);
  var needCat=false;
  try{needCat=localStorage.getItem("dc_catpending3")==="1";}catch(e){}
  if(!keys.length&&!needCat) return;
  _flushing=true;
  var done=0,total=keys.length+(needCat?1:0),okAll=true;
  function fin(ok){
    if(!ok)okAll=false;
    done++;
    if(done>=total){
      _flushing=false;
      setSyncStatus(navigator.onLine);
      if(okAll&&pendingCount()===0) toast("✅ सभी offline बदलाव sync हो गए","ok");
    }
  }
  keys.forEach(function(k){
    var it=p[k];
    if(it.type==="del"){
      fetch(FB+"/"+fbPath(it.hq,it.cat)+".json",{method:"DELETE"})
        .then(function(r){if(!r.ok)throw 0;clearPendingKey(k);setSyncStatus(true);fin(true);})
        .catch(function(e){if(navigator.onLine)logErr("sync-del-fail",e,it.hq+"/"+it.cat);setSyncStatus(false);fin(false);});
      return;
    }
    if(it.patch){
      // migrated HQ/श्रेणी — सिर्फ offline में बदले records PATCH करो; server के बाकी records को हाथ मत लगाओ
      // (इसलिए यहां fetch+merge की ज़रूरत नहीं — PATCH अपने-आप बाकी keys को बिना छेड़े रहने देता है)
      fetch(FB+"/"+fbPath(it.hq,it.cat)+".json",{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(it.patch)
      }).then(function(r){
        if(!r.ok)throw new Error("HTTP "+r.status);
        clearPendingKey(k);
        updTime();setSyncStatus(true);
        if(CU&&it.hq===activeHQ&&it.cat===activeCat){var d=cGet(it.hq,it.cat);renderSummaryWith(d);renderListWith(d);}
        fin(true);
      }).catch(function(e){if(navigator.onLine)logErr("sync-patch-fail",e,it.hq+"/"+it.cat);setSyncStatus(false);fin(false);});
      return;
    }
    // put (पुराना array फॉर्मेट) — पहले server data लो, merge करो, फिर save — दोनों के बदलाव बचें
    fetch(FB+"/"+fbPath(it.hq,it.cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        var server=normList(d);
        var merged=mergeArrays(cGet(it.hq,it.cat),server);
        return fetch(FB+"/"+fbPath(it.hq,it.cat)+".json",{
          method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify(merged)
        }).then(function(r2){
          if(!r2.ok)throw new Error("HTTP "+r2.status);
          cSet(it.hq,it.cat,merged);
          clearPendingKey(k);
          updTime();setSyncStatus(true);
          if(CU&&it.hq===activeHQ&&it.cat===activeCat){renderSummaryWith(merged);renderListWith(merged);}
          fin(true);
        });
      })
      .catch(function(e){if(navigator.onLine)logErr("sync-put-fail",e,it.hq+"/"+it.cat);setSyncStatus(false);fin(false);});
  });
  if(needCat){
    var reqs=Object.keys(CAT_NAMES).map(function(hq){
      var hqData={};
      [4,5,6,7].forEach(function(i){if(CAT_NAMES[hq]&&CAT_NAMES[hq][i]!=null)hqData[i]=CAT_NAMES[hq][i];});
      return fetch(FB+"/CAT_NAMES/"+hqKey(hq)+".json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(hqData)});
    });
    Promise.all(reqs).then(function(){
      try{localStorage.removeItem("dc_catpending3");}catch(e){}
      fin(true);
    }).catch(function(){fin(false);});
  }
}

// ── PREFETCH: login के बाद सभी HQ/category की लिस्ट background में download —
// ताकि हर लिस्ट बिना खोले भी offline available रहे ──
var _prefetchRun=false;
function prefetchAll(){
  if(!CU||!navigator.onLine||_prefetchRun) return;
  _prefetchRun=true;
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  var jobs=[];
  hqs.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      jobs.push({hq:hq,cat:(i>=4)?getCatName(hq,i):CATS_DEFAULT[i]});
    }
  });
  var idx=0,got=0;
  (function next(){
    if(idx>=jobs.length){
      _prefetchRun=false;
      if(got>0) toast("📥 "+got+" लिस्ट offline के लिए device पर save हो गईं","inf");
      return;
    }
    var j=jobs[idx++];
    if(isPending(j.hq,j.cat)){next();return;}
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        var data=normList(d);
        if(data.length){cSet(j.hq,j.cat,data);got++;}
        setTimeout(next,250);
      }).catch(function(){_prefetchRun=false;});
  })();
}

// CDN libraries (Excel/CSV) offline में load नहीं होतीं — नेट आने पर दोबारा load
function ensureLibs(){
  if(typeof XLSX==="undefined"){
    var s1=document.createElement("script");
    s1.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    document.head.appendChild(s1);
  }
  if(typeof Papa==="undefined"){
    var s2=document.createElement("script");
    s2.src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";
    document.head.appendChild(s2);
  }
}

