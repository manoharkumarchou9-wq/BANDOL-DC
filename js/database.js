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

var FB_GET_TIMEOUT_MS=8000; // टेस्ट में छोटा करके तेज़ जांच की जा सकती है
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
        trackUsageBytes(JSON.stringify(d||"").length);
        _checkMigrationRevert(hq,cat,d); // migrated list कहीं पुराने device ने वापस array में तो नहीं बदल दी
        var data=normList(d);
        overlayOps(hq,cat,data);
        var changed=JSON.stringify(data)!==JSON.stringify(cached);
        cSet(hq,cat,data);
        if(changed) cb(data);
        setSyncStatus(true);
      }).catch(function(){setSyncStatus(false);});
    return;
  }
  // Cache empty — network से load; कमज़ोर नेटवर्क पर हमेशा के लिए न अटकें —
  // तय समय (8 सेकंड) में जवाब न आए तो खाली लिस्ट के साथ आगे बढ़ो, UI न रुके
  var settled=false;
  var tm=setTimeout(function(){
    if(settled)return; settled=true;
    cb([]);
    setSyncStatus(false);
  },FB_GET_TIMEOUT_MS);
  fetch(FB+"/"+fbPath(hq,cat)+".json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      trackUsageBytes(JSON.stringify(d||"").length);
      _checkMigrationRevert(hq,cat,d);
      var data=normList(d);
      overlayOps(hq,cat,data);
      cSet(hq,cat,data);
      if(settled){
        // देर से जवाब आया — अगर अभी भी यही list खुली है तो ताज़ा data दिखा दो
        if(typeof CU!=="undefined"&&CU&&hq===activeHQ&&cat===activeCat){renderSummaryWith(data);renderListWith(data);}
        return;
      }
      settled=true; clearTimeout(tm);
      cb(data);
      setSyncStatus(true);
    })
    .catch(function(){
      if(settled)return; settled=true; clearTimeout(tm);
      cb([]);
      setSyncStatus(false);
    });
}

// prevArr हमेशा caller को खुद देना होगा (mutation से *पहले* का deep-clone snapshot) —
// यहां cGet(hq,cat) से prev निकालना ग़लत होगा, क्योंकि caller अक्सर वही array reference
// mutate करके पहले ही cSet कर चुका होता है, तो cGet यहां तक आते-आते नया (already-mutated) data
// ही लौटाता — prev===arr बन जाता और _diffToPatch को कभी कोई फ़र्क़ नहीं दिखता (patch हमेशा खाली,
// यानी मौजूदा record में कोई भी बदलाव — रिमार्क, वसूली वगैरह — Firebase पर कभी जाता ही नहीं था,
// सिर्फ़ स्थानीय cache में दिखता रहता और अगली असली sync में ग़ायब हो जाता — असली bug यही था)
function fbSet(hq,cat,arr,prevArr,cb){
  cSet(hq,cat,arr);
  if(arr.length>200){
    toast("⏳ "+arr.length+" records सेव हो रहे हैं...","inf");
  }
  if(isMigrated(hq,cat)) _fbPutPerRecord(hq,cat,prevArr||[],arr,cb);
  else _fbPut(hq,cat,arr,cb);
}

// पूरी array PUT करने वाला इकलौता (legacy) रास्ता — इसीलिए यहीं गारंटी दी गई है कि यह किसी
// migrated (per-record/object) HQ/श्रेणी पर कभी raw array नहीं भेजेगा, चाहे कोई भी caller
// (कोई भी 'acc missing' fallback वगैरह) इसे बुलाए — वरना माइग्रेशन चुपचाप पलट जाता (असली bug यही था)
function _fbPut(hq,cat,arr,cb){
  var body;
  if(isMigrated(hq,cat)){
    var obj={},skip=0;
    (arr||[]).forEach(function(x,i){
      if(!x||x.acc==null||String(x.acc).trim()===""){skip++;return;}
      var rec=JSON.parse(JSON.stringify(x));
      if(rec.o==null) rec.o=i;
      obj[String(x.acc).trim()]=rec;
    });
    if(skip) logErr("mig-noacc-skip",skip+" record बिना acc के मिले — उन्हें सेव नहीं किया (मैन्युअल जांच ज़रूरी), बाकी सुरक्षित रूप से per-record फॉर्मेट में सेव किए",hq+"/"+cat);
    body=JSON.stringify(obj);
  } else {
    body=JSON.stringify(arr);
  }
  fetch(FB+"/"+fbPath(hq,cat)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:body
  }).then(function(r){
    if(!r.ok) throw new Error("HTTP "+r.status);
    clearPendingKey(cKey(hq,cat));
    updTime(); setSyncStatus(true);
    if(cb) cb(true);
  }).catch(function(e){
    if(navigator.onLine) logErr("save-fail",e,hq+"/"+cat); // ऑनलाइन होते हुए save fail — असली गड़बड़
    markPending(hq,cat,"put",null,e);
    setSyncStatus(false);
    _saveFailToast(e);
    if(cb) cb(false);
  });
}

// "ऑफलाइन" कहना तभी सही है जब असली वजह नेटवर्क हो — 401/403 का मतलब है login session ही
// अमान्य हो गया (जैसे PIN बदल गया या token का auto-refresh नाकाम रहा), वहां गुमराह करने वाला
// "ऑफलाइन" न दिखाकर साफ़ बताएं कि दोबारा login चाहिए, ताकि यूज़र को असली समस्या पता चले
function _saveFailToast(e){
  var msg=(e&&e.message)||"";
  if(/HTTP (401|403)/.test(msg)){
    toast("🔐 सेव नहीं हुआ — login session खत्म हो गया लगता है। Logout करके दोबारा login करें","err");
  } else {
    toast("📴 ऑफलाइन — बदलाव device पर save है, नेट आते ही अपने आप sync होगा","inf");
  }
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
    markPending(hq,cat,"put",patch,e);
    setSyncStatus(false);
    _saveFailToast(e);
    if(cb) cb(false);
  });
}

// _diffToPatch का उल्टा काम — server से SSE "patch" event में मिला delta (acc: नया/बदला record,
// या acc: null यानी हटाया गया) local array पर लगाना, ताकि पूरी लिस्ट दोबारा मंगाने की ज़रूरत न पड़े
function _applyPatchToArray(arr,patch){
  var byAcc={};
  (arr||[]).forEach(function(x,i){ if(x&&x.acc!=null) byAcc[String(x.acc)]=i; });
  var out=(arr||[]).slice();
  var removeIdx=[];
  Object.keys(patch).forEach(function(k){
    var val=patch[k];
    if(val===null){
      if(byAcc.hasOwnProperty(k)) removeIdx.push(byAcc[k]);
    } else if(byAcc.hasOwnProperty(k)){
      out[byAcc[k]]=val;
    } else {
      out.push(val);
    }
  });
  if(removeIdx.length){
    removeIdx.sort(function(a,b){return b-a;}); // पीछे से हटाएं ताकि बाकी index न बिगड़ें
    removeIdx.forEach(function(i){ out.splice(i,1); });
  }
  return out;
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
    .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);clearPendingKey(cKey(hq,cat));if(cb)cb();})
    .catch(function(e){if(navigator.onLine)logErr("delete-fail",e,hq+"/"+cat);markPending(hq,cat,"del",null,e);toast("📴 ऑफलाइन — नेट आने पर लिस्ट सभी के लिए हटेगी","inf");if(cb)cb();});
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
    _checkMigrationRevert(hq,cat,d); // migrated list कहीं पुराने device ने वापस array में तो नहीं बदल दी
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

  // migrated (per-record) HQ/श्रेणी में "patch" event से मिला delta local array पर लगाना —
  // पूरी लिस्ट दोबारा मंगाने की ज़रूरत नहीं (bandwidth बचत, वैसे ही जैसे "put" event के लिए ऊपर की गई)
  // migration-revert जांच यहां ज़रूरी नहीं — "patch" event खुद सबूत है कि data अब भी सही per-record रूप में है
  function applyPatchLocal(patchData){
    var merged=_applyPatchToArray(cGet(hq,cat)||[],patchData);
    var data=normList(merged);
    overlayOps(hq,cat,data);
    var prev=cGet(hq,cat);
    var changed=JSON.stringify(data)!==JSON.stringify(prev);
    cSet(hq,cat,data);
    if(changed){
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
      es.addEventListener("patch",function(ev){
        if(isPending(hq,cat))return;
        try{
          var msg=JSON.parse(ev.data);
          if(msg&&msg.path==="/"&&msg.data&&typeof msg.data==="object"){
            applyPatchLocal(msg.data);
            return;
          }
        }catch(e){}
        pollOnce(); // सुरक्षित fallback
      });
      es.onopen=function(){setSyncStatus(true);};
      es.onerror=function(){
        setSyncStatus(false);
        if(es.readyState===2){ // CLOSED — स्ट्रीम पूरी तरह टूट गई (जैसे auth fail), polling पर वापस जाओ
          if(liveSource===es) liveSource=null;
          startPolling();
        }
        // वरना EventSource खुद reconnect करने की कोशिश करता रहेगा
      };
      // यहां pollOnce() जान-बूझकर नहीं बुलाया — caller (fbGet, हमेशा startListen से ठीक पहले/इसी
      // callback में चलता है) पहले ही ताज़ा data दिखा चुका होता है, और EventSource जुड़ते ही खुद अपना
      // पहला "put" event भेजता है जिसमें पूरा मौजूदा data होता है — तीसरी बार वही data डाउनलोड करना
      // सिर्फ़ बेवजह Firebase bandwidth (और पैसा) खर्च कर रहा था, कोई UI फ़ायदा नहीं था
    }catch(e){
      startPolling();
    }
  } else {
    startPolling();
  }

  // CAT_NAMES/MIGRATED flags कम बदलने वाली चीज़ें हैं (JE कभी-कभार नाम बदलता है) — 8 sec बहुत
  // ज़्यादा बार-बार था और bandwidth बेवजह खर्च करता था; 30 sec में भी बदलाव उतनी ही जल्दी दिख जाता है
  if(catNamesTimer) clearInterval(catNamesTimer);
  catNamesTimer=setInterval(function(){
    fetchCatNamesFromFB(true);
    loadMigratedFlags();
  },30000);
}

