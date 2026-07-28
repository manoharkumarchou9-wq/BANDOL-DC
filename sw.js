var CACHE_NAME="adegaon-dc-v57";
var CDN=[
  "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check-compat.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./css/style.css",
  "./js/config.js",
  "./js/logger.js",
  "./js/firebase.js",
  "./js/storage.js",
  "./js/database.js",
  "./js/ui-core.js",
  "./js/list.js",
  "./js/upload.js",
  "./js/reports.js",
  "./js/village.js",
  "./js/migration.js",
  "./js/home-scorecard.js",
  "./js/main.js"
];
self.addEventListener("install",function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(c){
      return Promise.all(CDN.concat(["./"]).map(function(u){
        return c.add(u).catch(function(){});
      }));
    }).then(function(){return self.skipWaiting();})
  );
});
self.addEventListener("activate",function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;}).map(function(k){return caches.delete(k);}));
    }).then(function(){return self.clients.claim();})
  );
});
self.addEventListener("fetch",function(e){
  var url=e.request.url;
  if(e.request.method!=="GET") return;
  if(url.indexOf("firebaseio.com")!==-1) return; /* data hamesha network se — app khud offline handle karta hai */
  e.respondWith(
    fetch(e.request).then(function(res){
      if(res && res.ok){
        var copy=res.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,copy);});
      }
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        if(m) return m;
        if(e.request.mode==="navigate") return caches.match("./");
      });
    })
  );
});
