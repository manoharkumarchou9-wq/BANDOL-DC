// INIT — बिना इन्टरनेट भी app तुरंत खुले
var _appStarted=false;
function startApp(){
  if(_appStarted)return; _appStarted=true;
  loadCatNames();
  loadMigratedFlags();
  rebuildCatsForHQ(HQS[0]);
  hideLoader();
  document.getElementById("login-screen").classList.add("active");
  setSyncStatus(navigator.onLine);
  hscLoadLocal(); renderHomeSc();
  if(navigator.onLine){ensureLibs();flushPending();hscFetch();}
}
setTimeout(startApp,2000); // network धीमा/बंद हो तो भी app खुल जाए
fetch(FB+"/.json?shallow=true&t="+Date.now())
  .then(function(){setSyncStatus(true);startApp();})
  .catch(function(){setSyncStatus(false);startApp();});
