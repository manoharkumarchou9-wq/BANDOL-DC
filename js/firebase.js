var FB = "https://adegaon-dc-top-50-default-rtdb.firebaseio.com";
var CACHE = {};

// ── FIREBASE AUTH: गुमनाम (anonymous) sign-in — बिना इसके अब DB access नहीं मिलेगा ──
// (config secret नहीं है — असली सुरक्षा Firebase Security Rules से आती है, इसे छुपाने की ज़रूरत नहीं)
var firebaseConfig = {
  apiKey: "AIzaSyAPFZ2wqPYVMyvU4WqYrKUinVERBkVqdmY",
  authDomain: "adegaon-dc-top-50.firebaseapp.com",
  databaseURL: "https://adegaon-dc-top-50-default-rtdb.firebaseio.com",
  projectId: "adegaon-dc-top-50",
  storageBucket: "adegaon-dc-top-50.firebasestorage.app",
  messagingSenderId: "265994697235",
  appId: "1:265994697235:web:6158cdf1200bd86c201de6"
};
var ID_TOKEN = null;
var AC_TOKEN = null; // App Check token — साबित करता है कि request असली app से है (अभी monitor mode)
var AC_READY = false; // पहला App Check token मिल चुका है (सफल/असफल दोनों) — वरना request अनिश्चित काल इंतज़ार न करे
var _tokenWaiters = []; // app खुलते ही token बनने से पहले निकली DB-calls यहां इंतज़ार करती हैं
var _acWaiters = []; // वैसे ही App Check token के लिए — पहले सिर्फ ID_TOKEN का इंतज़ार होता था, इसलिए ज़्यादातर requests बिना App Check header के निकल जाती थीं (Verified% कम दिखता था)
try{
  firebase.initializeApp(firebaseConfig);
  try{
    firebase.appCheck().activate("6LdPa10tAAAAAHH1aA7E31NHC1c2k9k0WFEQ7UZX", true); // true = token अपने आप refresh
    var _acRefresh=function(){
      firebase.appCheck().getToken(false)
        .then(function(t){AC_TOKEN=(t&&t.token)||null;})
        .catch(function(){})
        .then(function(){
          if(!AC_READY){AC_READY=true; _acWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});}
        });
    };
    _acRefresh();
    setInterval(_acRefresh, 30*60*1000);
  }catch(eAC){AC_READY=true;}
  firebase.auth().onIdTokenChanged(function(u){
    if(u){
      u.getIdToken().then(function(t){
        ID_TOKEN=t;
        _tokenWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});
      });
    }
    else { firebase.auth().signInAnonymously().catch(function(){setSyncStatus(false);}); }
  });
}catch(e){}

// FB (Realtime Database) की हर fetch call में auth token अपने आप जुड़ जाए — कहीं और कोड बदलने की ज़रूरत नहीं
// token अभी न बना हो तो 4 sec तक इंतज़ार — वरना app खुलते ही निकली save बिना token के 401 खा जाती है
var _rawFetch = window.fetch.bind(window);
function _withToken(url){
  return url + (url.indexOf("?")>-1?"&":"?") + "auth=" + encodeURIComponent(ID_TOKEN);
}
// App Check token हो तो header में जोड़ें (caller के opts को बिना छेड़े copy बनाकर)
function _fbOpts(opts){
  if(!AC_TOKEN) return opts;
  var o={}, k;
  if(opts) for(k in opts) o[k]=opts[k];
  var h={};
  if(o.headers) for(k in o.headers) h[k]=o.headers[k];
  h["X-Firebase-AppCheck"]=AC_TOKEN;
  o.headers=h;
  return o;
}
// token पुराना (expired) हो तो Firebase 401 देता है — device लंबे समय background में पड़ा रहने पर
// SDK का अपने-आप refresh timer देर से चलता है; इसलिए 401 मिलते ही token ज़बरदस्ती ताज़ा करके
// एक बार दोबारा कोशिश करो (PUT/PATCH/DELETE/GET सभी idempotent हैं — दोबारा भेजना सुरक्षित है)
function _fbFetchOnce(url,opts){ return _rawFetch(_withToken(url), _fbOpts(opts)); }
// App Check "enforce" मोड में कमज़ोर नेटवर्क पर reCAPTCHA token समय पर न बन पाए तो 403 आ सकता है —
// ऐसे में भी ज़बरदस्ती नया App Check token लेकर एक बार दोबारा कोशिश करो। अगर असली वजह Security
// Rules से permission-denied हो, तो retry भी वैसे ही 403 देगा — कोई नुकसान नहीं, सिर्फ़ एक अतिरिक्त कोशिश
function _acForceRefresh(){
  try{
    return firebase.appCheck().getToken(true)
      .then(function(t){AC_TOKEN=(t&&t.token)||null;})
      .catch(function(){});
  }catch(e){return Promise.resolve();}
}
function _fbFetchWithAuth(url,opts){
  return _fbFetchOnce(url,opts).then(function(r){
    if(r.status===401){
      var u=firebase.auth().currentUser;
      if(!u) return r;
      return u.getIdToken(true).then(function(t){
        ID_TOKEN=t;
        return _fbFetchOnce(url,opts);
      }).catch(function(){return r;});
    }
    if(r.status===403){
      return _acForceRefresh().then(function(){
        return _fbFetchOnce(url,opts);
      });
    }
    return r;
  });
}
window.fetch = function(url, opts){
  if(typeof url==="string" && url.indexOf(FB)===0){
    if(ID_TOKEN && AC_READY) return _fbFetchWithAuth(url,opts);
    if(!navigator.onLine) return _rawFetch(url, opts); // offline — तुरंत fail होकर offline-queue संभाले
    return new Promise(function(resolve){
      var done=false;
      var tm=setTimeout(function(){
        if(done)return; done=true;
        resolve(ID_TOKEN?_fbFetchWithAuth(url,opts):_rawFetch(url,opts));
      },4000);
      function check(){
        if(done||!ID_TOKEN||!AC_READY)return;
        done=true; clearTimeout(tm);
        resolve(_fbFetchWithAuth(url,opts));
      }
      if(ID_TOKEN) check(); else _tokenWaiters.push(check);
      if(AC_READY) check(); else _acWaiters.push(check);
    });
  }
  return _rawFetch(url, opts);
};

