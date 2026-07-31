// INIT — बिना इन्टरनेट भी app तुरंत खुले
var _appStarted=false;
function startApp(){
  if(_appStarted)return; _appStarted=true;
  loadCatNames();
  loadMigratedFlags();
  loadHQPins();
  rebuildCatsForHQ(HQS[0]);
  hideLoader();
  setSyncStatus(navigator.onLine);
  hscLoadLocal(); renderHomeSc();
  if(navigator.onLine){ensureLibs();flushPending();hscFetch();}
  // Pull-to-refresh जैसा असली page reload भी CU (JS memory) मिटा देता है — सेव किया हुआ session
  // मिले तो login screen दिखाए बिना चुपचाप वापस अंदर ले जाएं (Firebase का अपना auth session वैसे
  // भी reload के बाद बना रहता है — यह सिर्फ़ app की अपनी UI उसी के साथ मिला रहा है)
  var savedCU=null;
  try{var s=sessionStorage.getItem("dc_cu"); if(s) savedCU=JSON.parse(s);}catch(e){}
  if(savedCU&&savedCU.role&&savedCU.hq&&savedCU.name){
    CU=savedCU;
    _finishLogin(CU.name,true);
  } else {
    document.getElementById("login-screen").classList.add("active");
  }
}
setTimeout(startApp,2000); // network धीमा/बंद हो तो भी app खुल जाए
fetch(FB+"/.json?shallow=true&t="+Date.now())
  .then(function(){setSyncStatus(true);startApp();})
  .catch(function(){setSyncStatus(false);startApp();});
