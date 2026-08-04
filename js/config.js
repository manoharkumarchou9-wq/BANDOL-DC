var HQS = ["आदेगांव","पिंडरई","जोबा","पाटन","बीबी","मढ़ी"];
var CATS = ["कुल उपभोक्ता","घरेलू","व्यवसाय","कृषि","गवर्नमेंट","इंडस्ट्रियल","सूची-2","सूची-3"];
var CICO = ["👥","🏠","🏪","🌾","🏛️","🏭","📋","📌"];
// JE का पासवर्ड अब code में नहीं — Firebase Authentication से verify होता है (देखें ui-core.js: verifyJE)
var JE_EMAIL = "pradeepks2015@gmail.com";
// हर HQ का अपना असली (गुमनाम नहीं) Firebase account — Security Rules अब सिर्फ़ इसी HQ के account
// (या JE) को उस HQ का data पढ़ने/लिखने देती हैं। password नहीं है यहां — वो लाइनमैन के टाइप किए
// PIN से बनता है (देखें ui-core.js: _hqAuthPassword), ताकि कोड में कोई असली secret न रहे।
var HQ_AUTH_EMAIL = {
  "आदेगांव":"hq-adegaon@adegaondc.internal",
  "पिंडरई":"hq-pindrai@adegaondc.internal",
  "जोबा":"hq-joba@adegaondc.internal",
  "पाटन":"hq-patan@adegaondc.internal",
  "बीबी":"hq-bibi@adegaondc.internal",
  "मढ़ी":"hq-madhi@adegaondc.internal"
};
var APP_VER = "9.78"; // हर अपडेट पर यह नंबर बढ़ाएं
document.getElementById("ver-badge").textContent="Version "+APP_VER+" • Offline + Auto Sync";
var MAX_RECORDS = 1000;
// Per-category limits: "कुल उपभोक्ता"=3500, others=1000
function getMaxRecords(cat){
  if(!cat) return MAX_RECORDS;
  if(cat==="कुल उपभोक्ता") return 3500;
  return 1000;
}
// Editable cat names stored here (keys are fixed slots 5,6,7)
// ── CAT_NAMES System ─────────────────────────────────────────
// Firebase path: /CAT_NAMES/{HQ_key}/{cat_index} = "नाम"
// Non-editable: index 0,1,2,3 | Editable: 4,5,6,7
var CATS_DEFAULT = ["कुल उपभोक्ता","घरेलू","व्यवसाय","कृषि","गवर्नमेंट","इंडस्ट्रियल","सूची-2","सूची-3"];
var CAT_NAMES = {}; // {HQ: {4:"नाम", 5:"नाम", 6:"नाम", 7:"नाम"}}

function hqKey(hq){ return (hq||activeHQ).replace(/[\s.#$\[\]]/g,"_"); }
function catKey(cat){ return (cat||"").replace(/[\s.#$\[\]]/g,"_"); }

function getCatName(hq,i){
  return (CAT_NAMES[hq]&&CAT_NAMES[hq][i]!=null) ? CAT_NAMES[hq][i] : CATS_DEFAULT[i];
}

function rebuildCatsForHQ(hq){
  if(!hq) hq=activeHQ;
  for(var i=0;i<CATS_DEFAULT.length;i++){
    CATS[i] = (i>=4) ? getCatName(hq,i) : CATS_DEFAULT[i];
  }
}

function saveCatNames(){
  try{localStorage.setItem("dc_catnames3",JSON.stringify(CAT_NAMES));}catch(e){}
}

function applyFBCatNames(d){
  if(!d||typeof d!=="object") return false;
  var changed=false;
  Object.keys(d).forEach(function(hk){
    var hq=HQS.find(function(h){return hqKey(h)===hk;})||hk;
    if(!CAT_NAMES[hq]) CAT_NAMES[hq]={};
    [4,5,6,7].forEach(function(i){
      if(d[hk][i]!=null&&CAT_NAMES[hq][i]!==d[hk][i]){
        CAT_NAMES[hq][i]=d[hk][i]; changed=true;
      }
    });
  });
  return changed;
}

function loadCatNames(){
  try{var s=localStorage.getItem("dc_catnames3");if(s)CAT_NAMES=JSON.parse(s);}catch(e){}
  fetchCatNamesFromFB(false);
}

function fetchCatNamesFromFB(showToast){
  fetch(FB+"/CAT_NAMES.json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      var changed=applyFBCatNames(d);
      if(changed){
        saveCatNames();
        if(activeHQ) rebuildCatsForHQ(activeHQ);
        if(CU&&document.getElementById("app-screen").classList.contains("active")){
          buildCatTabs();
          if(showToast) toast("🔄 श्रेणी नाम अपडेट हुए","inf");
        }
      }
    }).catch(function(){});
}
var CU = null, activeHQ = "", activeCat = "", activeFilter = "all";
var upMode = "merge", parsedRows = [], selectedRole = "", rmkStatus = "pending";
var pollTimer = null;
