function showLoader(t){document.getElementById("loader-text").textContent=t||"लोड हो रहा है...";document.getElementById("loader").classList.remove("hidden");}
function hideLoader(){document.getElementById("loader").classList.add("hidden");}

function toast(msg,type){
  var t=document.getElementById("toast");
  t.textContent=msg; t.className="toast show "+(type||"");
  clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("show");},3500);
}

function setSyncStatus(ok){
  var d=document.getElementById("sdot"),t=document.getElementById("stxt");
  if(!d)return;
  var n=pendingCount();
  d.className=ok?"sdot":"sdot off";
  t.className=ok?"stxt":"stxt off";
  if(ok) t.textContent=n?("🔄 "+n+" बदलाव sync हो रहे…"):"Live Sync ✓";
  else t.textContent=n?("📴 ऑफलाइन • "+n+" बदलाव save — नेट पर sync होंगे"):"📴 ऑफलाइन — data device पर save है";
}

function updTime(){
  var now=new Date(),el=document.getElementById("stime");
  if(el) el.textContent=now.getHours()+":"+String(now.getMinutes()).padStart(2,"0");
}

// Format date+time for display
function fmtDateTime(dt){
  if(!dt) return "";
  return dt;
}

window.addEventListener("online",function(){
  setSyncStatus(true);
  ensureLibs();
  flushPending();
  fetchCatNamesFromFB(false);
  _prefetchRun=false; setTimeout(prefetchAll,3000);
  hscFetch();
  if(CU&&activeHQ&&activeCat&&!isPending(activeHQ,activeCat)){
    fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
  }
});
window.addEventListener("offline",function(){setSyncStatus(false);});
// हर 20 sec — pending बदलाव हों और नेट हो तो sync करते रहो
setInterval(function(){
  var needCat=false;try{needCat=localStorage.getItem("dc_catpending3")==="1";}catch(e){}
  if(navigator.onLine&&(pendingCount()>0||needCat))flushPending();
},20000);

function toggleUserMenu(e){
  e.stopPropagation();
  var m=document.getElementById("logout-menu");
  m.classList.toggle("open");
}
document.addEventListener("click",function(){
  var m=document.getElementById("logout-menu");
  if(m) m.classList.remove("open");
});

function goBack(){
  if(document.getElementById("rmk-overlay").classList.contains("open")){closeRmkModal();return;}
  if(document.getElementById("up-overlay").classList.contains("open")){closeUpModal();return;}
  if(activeFilter!=="all"){
    activeFilter="all";
    document.querySelectorAll(".filter-btn").forEach(function(b){b.className="filter-btn";});
    document.querySelector("[data-f='all']").className="filter-btn active-all";
    fbGet(activeHQ,activeCat,function(d){renderListWith(d);});
    return;
  }
  if(activeCat!=="घरेलू"){
    activeCat="घरेलू"; activeFilter="all";
    buildCatTabs();
    fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
    startListen(activeHQ,activeCat);
    return;
  }
  if(CU&&CU.role==="supervisor"){
    var idx=HQS.indexOf(activeHQ);
    if(idx>0){
      activeHQ=HQS[idx-1];
      rebuildCatsForHQ(activeHQ);
      buildHQTabs();
      fbGet(activeHQ,activeCat,function(d){renderSummaryWith(d);renderListWith(d);});
      startListen(activeHQ,activeCat);
      return;
    }
  }
  // सबसे पीछे — login page पर जाएं (lineman के लिए, या supervisor पहले HQ पर)
  // बिना पूछे लॉगआउट जैसा महसूस न हो, इसलिए पक्का पूछें
  if(!confirm("लॉगआउट करना चाहते हैं?"))return;
  goToLogin();
}

function goToLogin(){
  // Go to login screen without clearing user data (stays logged in visually)
  stopListen();
  if(catNamesTimer){clearInterval(catNamesTimer);catNamesTimer=null;}
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  // Re-init on next login click — don't clear fields so user can re-enter easily
}

function selectRole(r){
  selectedRole=r;
  document.getElementById("rc-sup").classList.toggle("selected",r==="supervisor");
  document.getElementById("rc-lin").classList.toggle("selected",r==="lineman");
  document.getElementById("sup-fields").style.display=r==="supervisor"?"block":"none";
  document.getElementById("lin-fields").style.display=r==="lineman"?"block":"none";
}

function togglePw(){var i=document.getElementById("sup-pw");i.type=i.type==="password"?"text":"password";}

// ── JE पासवर्ड verify — असली जाँच Firebase Authentication करता है, code में पासवर्ड कहीं नहीं ──
function _sha256(str){
  if(!(window.crypto&&crypto.subtle&&window.TextEncoder)) return Promise.reject(new Error("no-crypto"));
  return crypto.subtle.digest("SHA-256",new TextEncoder().encode(str)).then(function(buf){
    return Array.prototype.map.call(new Uint8Array(buf),function(b){return ("0"+b.toString(16)).slice(-2);}).join("");
  });
}
// online login सफल होने पर hash device पर save — ताकि बाद में offline भी JE login चले
function _saveJEHash(pw){_sha256("dcje|"+pw).then(function(h){try{localStorage.setItem("dc_jeh",h);}catch(e){}}).catch(function(){});}
function _checkJEHash(pw,cb){
  var h=null; try{h=localStorage.getItem("dc_jeh");}catch(e){}
  if(!h){cb(false,"पहली बार JE login के लिए इन्टरनेट ज़रूरी है");return;}
  _sha256("dcje|"+pw).then(function(x){cb(x===h,x===h?null:"गलत पासवर्ड!");}).catch(function(){cb(false,"यह ब्राउज़र offline JE login support नहीं करता");});
}
var JE_VERIFY_TIMEOUT_MS=6000; // टेस्ट में छोटा करके तेज़ जांच की जा सकती है
function verifyJE(pw,cb){
  if(!pw){cb(false,"पासवर्ड डालें");return;}
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(navigator.onLine&&fbAuthOk){
    showLoader("JE पासवर्ड जाँच रहे हैं...");
    // navigator.onLine सही होते हुए भी सिग्नल कमज़ोर हो तो सर्वर जवाब देर से दे सकता है —
    // तय समय में जवाब न आए तो हमेशा के लिए न अटकें, offline hash से आगे बढ़ जाएं
    var settled=false;
    var tm=setTimeout(function(){
      if(settled)return; settled=true;
      hideLoader();
      _checkJEHash(pw,cb);
    },JE_VERIFY_TIMEOUT_MS);
    firebase.auth().signInWithEmailAndPassword(JE_EMAIL,pw)
      .then(function(){
        _saveJEHash(pw); // भले cb timeout से जा चुका हो, hash फिर भी ताज़ा रख दो
        if(settled)return; settled=true; clearTimeout(tm);
        hideLoader();cb(true,null);
      })
      .catch(function(e){
        if(settled)return; settled=true; clearTimeout(tm);
        hideLoader();
        if(e&&e.code==="auth/network-request-failed"){_checkJEHash(pw,cb);return;} // नेट बीच में टूटा — offline hash से
        cb(false,"गलत पासवर्ड!");
      });
  } else {
    _checkJEHash(pw,cb); // offline — पिछले online login के hash से
  }
}

// ── Lineman PIN: हर HQ का एक साझा PIN (सामान्य सुरक्षा-मज़बूती — कोई भी नाम भरकर न घुस सके) ──
// असली access-control नहीं (Security Rules अलग से restrict नहीं करतीं) — JE खुद /HQ_PIN में सेट/बदल सकते हैं
var HQ_PINS={};
function loadHQPins(){
  try{var s=localStorage.getItem("dc_hqpins");if(s)HQ_PINS=JSON.parse(s);}catch(e){}
  fetchHQPinsFromFB();
}
function fetchHQPinsFromFB(){
  fetch(FB+"/HQ_PIN.json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      if(d&&typeof d==="object"){
        HQ_PINS=d;
        try{localStorage.setItem("dc_hqpins",JSON.stringify(d));}catch(e){}
      }
    }).catch(function(){});
}
function openPinModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE PIN सेट कर सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  var el=document.getElementById("pin-fields");
  el.innerHTML=HQS.map(function(hq){
    var v=HQ_PINS[hqKey(hq)]||"";
    return "<label class='f-label'>"+escHtml(hq)+"</label><input type='text' inputmode='numeric' class='f-input' id='pin-"+hqKey(hq)+"' value='"+escHtml(v)+"' placeholder='खाली = PIN ज़रूरी नहीं' style='margin-bottom:10px;'>";
  }).join("");
  document.getElementById("pin-overlay").classList.add("open");
}
function closePinModal(){document.getElementById("pin-overlay").classList.remove("open");}
function savePins(){
  var d={};
  HQS.forEach(function(hq){
    var v=document.getElementById("pin-"+hqKey(hq)).value.trim();
    if(v) d[hqKey(hq)]=v;
  });
  fetch(FB+"/HQ_PIN.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)})
    .then(function(r){
      if(!r.ok) throw new Error("HTTP "+r.status);
      HQ_PINS=d;
      try{localStorage.setItem("dc_hqpins",JSON.stringify(d));}catch(e){}
      toast("✅ PIN सेव हो गए","ok");
      closePinModal();
    })
    .catch(function(e){logErr("pin-save-fail",e);toast("⚠️ सेव नहीं हुआ — दोबारा कोशिश करें","err");});
}

function doLogin(){
  var role=selectedRole,name=document.getElementById("uname-inp").value.trim();
  if(!role){toast("भूमिका चुनें","err");return;}
  if(!name){toast("अपना नाम लिखें","err");return;}
  if(role==="supervisor"){
    verifyJE(document.getElementById("sup-pw").value,function(ok,msg){
      if(!ok){toast(msg||"गलत पासवर्ड!","err");return;}
      CU={role:"supervisor",name:name,hq:HQS[0]};
      _finishLogin(name);
    });
    return;
  }
  var hq=document.getElementById("hq-sel").value;
  if(!hq){toast("HQ चुनें","err");return;}
  var expectedPin=HQ_PINS[hqKey(hq)];
  var typedPin=document.getElementById("lin-pin").value.trim();
  if(expectedPin&&typedPin!==expectedPin){
    toast("गलत PIN! JE से सही PIN लें","err");return;
  }
  // PIN सही है और उस HQ का असली Firebase account मौजूद है — anonymous की जगह उसी से sign-in करें
  // (Security Rules अब सिर्फ़ यही असली पहचान जांचती हैं — असली access-control server से)
  var hqEmail=HQ_AUTH_EMAIL[hq];
  var fbAuthOk=false;
  try{fbAuthOk=typeof firebase!=="undefined"&&!!firebase.auth;}catch(e){}
  if(expectedPin&&hqEmail&&navigator.onLine&&fbAuthOk){
    showLoader("लॉगिन हो रहा है...");
    firebase.auth().signInWithEmailAndPassword(hqEmail,_hqAuthPassword(typedPin))
      .then(function(){
        hideLoader();
        CU={role:"lineman",name:name,hq:hq};
        _finishLogin(name);
      })
      .catch(function(e){
        hideLoader();
        if(e&&e.code==="auth/network-request-failed"){ // नेट बीच में टूटा — पुराने session/cache पर आगे बढ़ें
          CU={role:"lineman",name:name,hq:hq};
          _finishLogin(name);
          return;
        }
        toast("गलत PIN या सर्वर से जुड़ नहीं पाया — दोबारा कोशिश करें","err");
      });
    return;
  }
  // PIN सेट नहीं है इस HQ का, या ऑफलाइन हैं — पुराने (anonymous) तरीके से आगे बढ़ें
  try{
    var u=firebase.auth().currentUser;
    if(u&&u.email) firebase.auth().signOut();
  }catch(e){}
  CU={role:"lineman",name:name,hq:hq};
  _finishLogin(name);
}
// PIN से Firebase password बनाना — कम से कम 6 अक्षर चाहिए, इसलिए आगे एक तय prefix जोड़ते हैं
// (असली secret PIN ही है, यह prefix कोई गोपनीयता नहीं जोड़ता, सिर्फ़ Firebase की न्यूनतम लंबाई पूरी करता है)
function _hqAuthPassword(pin){ return "vasuli-"+pin; }

function _finishLogin(name){
  activeHQ=CU.hq; activeFilter="all";
  rebuildCatsForHQ(activeHQ);
  activeCat=CATS[0];
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  buildUI();
  showLoader("डेटा लोड हो रहा है...");
  fbGet(activeHQ,activeCat,function(data){
    renderSummaryWith(data); renderListWith(data);
    startListen(activeHQ,activeCat);
    hideLoader(); toast("स्वागत है "+name+"!","ok");
    setTimeout(prefetchAll,1500); // सभी लिस्ट offline के लिए download
    startDevicePing(); // यह device किस app version पर है — Firebase पर दर्ज करें
  });
}

function doLogout(askConfirm){
  if(askConfirm===undefined) askConfirm=true;
  if(askConfirm&&!confirm("लॉगआउट करना चाहते हैं?"))return;
  // JE था तो Firebase session भी हटाएं — अपने आप anonymous पर लौट जाएगा (firebase.js का onIdTokenChanged)
  try{
    var u=firebase.auth().currentUser;
    if(u&&u.email) firebase.auth().signOut();
  }catch(e){}
  stopListen();
  if(catNamesTimer){clearInterval(catNamesTimer);catNamesTimer=null;}
  stopDevicePing();
  CU=null; selectedRole="";
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  document.getElementById("uname-inp").value="";
  document.getElementById("sup-pw").value="";
  document.getElementById("hq-sel").value="";
  document.getElementById("lin-pin").value=""; // वरना shared device पर अगला लाइनमैन पुराने PIN से ही login कोशिश करता रह जाता (PIN mismatch से login fail — दिखता है जैसे logout ने कुछ किया ही नहीं)
  document.getElementById("rc-sup").classList.remove("selected");
  document.getElementById("rc-lin").classList.remove("selected");
  document.getElementById("sup-fields").style.display="none";
  document.getElementById("lin-fields").style.display="none";
  var m=document.getElementById("logout-menu");
  if(m) m.classList.remove("open");
}

// नाम से तय रंग — बिना किसी फ़ोटो/स्टोरेज के हर व्यक्ति का अपना अलग एवतार रंग
var AVATAR_PALETTE=[
  ["#1f6fb2","#134a75"],["#0d6efd","#0a4fb5"],["#086b52","#054d3a"],
  ["#a34d00","#7a3900"],["#7b3fd1","#5a2ba0"],["#c41f3d","#8f1630"],
  ["#00695c","#004d43"],["#455a64","#2c3d45"]
];
function _avatarColor(name){
  var h=0;
  for(var i=0;i<(name||"").length;i++) h=(h*31+name.charCodeAt(i))>>>0;
  var pair=AVATAR_PALETTE[h%AVATAR_PALETTE.length];
  return "linear-gradient(135deg,"+pair[0]+","+pair[1]+")";
}
function buildUI(){
  var dot=document.getElementById("udot");
  dot.textContent=CU.name[0].toUpperCase();
  dot.className="udot";
  dot.style.background=_avatarColor(CU.name);
  document.getElementById("uname-disp").textContent=CU.name;
  document.getElementById("hdr-sub").textContent=CU.role==="supervisor"?"JE | सभी HQ":"Lineman | "+CU.hq;
  var info=document.getElementById("user-info-menu");
  if(info) info.textContent=(CU.role==="supervisor"?"👨‍💼 JE":"🔧 Lineman")+" | "+CU.hq+" | "+CU.name+" | v"+APP_VER;
  ["log-menu-item","hsc-menu-item","cash-menu-item","backup-menu-item","wasc-menu-item","mig-menu-item","pin-menu-item"].forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.style.display=CU.role==="supervisor"?"flex":"none";
  });
  buildHQTabs(); buildCatTabs(); buildActionBtns();
  _profilePhotoCache=null; loadProfilePhoto();
}

function buildHQTabs(){
  var c=document.getElementById("hq-tabs"); c.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){
    var b=document.createElement("button");
    b.className="hq-tab"+(hq===activeHQ?" active":"");
    b.textContent=hq;
    b.onclick=function(){
      activeHQ=hq; activeFilter="all";
      rebuildCatsForHQ(hq);
      activeCat=CATS[0]; // reset to first cat of new HQ
      buildHQTabs();
      buildCatTabs();
      showLoader();
      fbGet(activeHQ,activeCat,function(data){
        renderSummaryWith(data); renderListWith(data);
        startListen(activeHQ,activeCat); hideLoader();
      });
    };
    c.appendChild(b);
  });
}

function buildCatTabs(){
  rebuildCatsForHQ(activeHQ); // हर बार current HQ के नाम लो
  var c=document.getElementById("cat-tabs"); c.innerHTML="";
  CATS.forEach(function(cat,i){
    var wrap=document.createElement("div");
    wrap.style.cssText="display:flex;align-items:center;gap:3px;flex-shrink:0;";
    var b=document.createElement("button");
    b.className="cat-tab"+(cat===activeCat?" active c"+i:" c"+i);
    b.onclick=function(){
      activeCat=cat; activeFilter="all"; _renderLimit=100;
      document.querySelectorAll(".filter-btn").forEach(function(x){x.className="filter-btn";});
      document.querySelector("[data-f='all']").className="filter-btn active-all";
      buildCatTabs(); showLoader();
      fbGet(activeHQ,activeCat,function(data){
        renderSummaryWith(data); renderListWith(data);
        startListen(activeHQ,activeCat); hideLoader();
      });
    };
    b.textContent=CICO[i]+" "+cat;
    wrap.appendChild(b);
    // Edit button — सिर्फ JE (supervisor) को, घरेलू/व्यवसाय/कृषि/कुल उपभोक्ता fixed
    if(i!==0&&i!==1&&i!==2&&i!==3&&CU&&CU.role==="supervisor"){
      var slotKey="cat"+i;
      var e2=document.createElement("button");
      e2.textContent="✏️";
      e2.style.cssText="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;";
      e2.title="नाम बदलें";
      (function(idx,sk){
        e2.onclick=function(ev){ev.stopPropagation();openEditCat(idx,sk);};
      })(i,slotKey);
      wrap.appendChild(e2);
    }
    c.appendChild(wrap);
  });
}

function openEditCat(i, slotKey){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE नाम बदल सकते हैं","err");return;}
  var cur=CATS[i];
  var newName=prompt(activeHQ+" — श्रेणी का नया नाम डालें:",cur);
  if(!newName||!newName.trim()||newName.trim()===cur) return;
  newName=newName.trim();
  var oldCat=CATS[i];
  // 1. Cache rename
  var d=cGet(activeHQ,oldCat);
  if(d&&d.length) cSet(activeHQ,newName,d);
  cSet(activeHQ,oldCat,[]);
  // 2. Local CAT_NAMES update
  if(!CAT_NAMES[activeHQ]) CAT_NAMES[activeHQ]={};
  CAT_NAMES[activeHQ][i]=newName;
  saveCatNames();
  // 3. CATS rebuild + UI update immediately
  rebuildCatsForHQ(activeHQ);
  if(activeCat===oldCat) activeCat=newName;
  buildCatTabs();
  // 4. Firebase save — single PUT for this HQ's all cat names
  var hqData={};
  [4,5,6,7].forEach(function(idx){
    if(CAT_NAMES[activeHQ]&&CAT_NAMES[activeHQ][idx]!=null){
      hqData[idx]=CAT_NAMES[activeHQ][idx];
    }
  });
  fetch(FB+"/CAT_NAMES/"+hqKey(activeHQ)+".json",{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(hqData)
  }).then(function(r){
    if(r.ok){toast("✅ नाम बदला: "+newName+" (सभी को दिखेगा)","ok");return;}
    logErr("catname-save",new Error("HTTP "+r.status));
    if(r.status===401||r.status===403)
      toast("🔐 नाम server पर नहीं गया — JE नेट चालू रखकर logout करके दोबारा login करें","err");
    else
      toast("⚠️ नाम बदला पर sync नहीं हुआ (HTTP "+r.status+")","err");
  }).catch(function(){try{localStorage.setItem("dc_catpending3","1");}catch(e){}toast("📴 ऑफलाइन — नाम save है, नेट आने पर सभी को दिखेगा","inf");});
}

function buildActionBtns(){
  var c=document.getElementById("action-btns"); c.innerHTML="";
  var b1=document.createElement("button");
  b1.className="tbtn tbtn-blue"; b1.innerHTML="📤 अपलोड"; b1.onclick=openUpModal;
  c.appendChild(b1);
  if(CU.role==="supervisor"){
    var b2=document.createElement("button");
    b2.className="tbtn tbtn-red"; b2.innerHTML="🗑️ हटाएं"; b2.onclick=clearList;
    c.appendChild(b2);
    // होम पेज डिस्प्ले बोर्ड और कैश लिस्ट अब profile dropdown में हैं (buildUI देखें)
  }
}

