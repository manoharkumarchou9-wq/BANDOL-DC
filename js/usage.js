// ── DATA USAGE TRACKING: Firebase Blaze plan पर इस्तेमाल के हिसाब से बिल आता है, कोई hard limit
// नहीं जो पहले से रोक दे — इसलिए ऐप के अंदर पढ़े गए डेटा के अनुमानित आकार को track करके महीने-दर-महीने
// ट्रेंड दिखाया जाता है, ताकि कोई असामान्य बढ़ोतरी (जैसे कोई bug जो बार-बार पूरा डेटा खींच रहा हो)
// अचानक बड़े bill के तौर पर सामने आने से पहले ही पकड़ में आ जाए। यह सटीक billing नहीं — सिर्फ़ अनुमान।
var _usageBytes=0;
function trackUsageBytes(n){ if(n>0) _usageBytes+=n; }
function _usageFlush(){
  if(_usageBytes<=0||!navigator.onLine||typeof FB==="undefined")return;
  var bytes=_usageBytes; _usageBytes=0;
  var month=new Date().toISOString().slice(0,7); // YYYY-MM
  fetch(FB+"/USAGE/"+month+".json",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({d:(typeof DEV_ID!=="undefined"?DEV_ID:"?"),b:bytes,t:Date.now()})
  }).catch(function(){});
}
setInterval(_usageFlush,5*60*1000); // हर 5 मिनट में जमा हुआ इस्तेमाल भेज दें
window.addEventListener("beforeunload",_usageFlush);
document.addEventListener("visibilitychange",function(){ if(document.visibilityState==="hidden") _usageFlush(); });

// ── DATA USAGE VIEWER (सिर्फ JE) ──
function openUsageModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE डेटा उपयोग देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("usage-overlay").classList.add("open");
  document.getElementById("usage-content").innerHTML="<div class='log-empty'>लोड हो रहा है...</div>";
  _usageFlush(); // अभी तक जमा हुआ इस्तेमाल भी हिसाब में शामिल करें
  _usageRender();
  _usageCleanupOld();
}
function closeUsageModal(){document.getElementById("usage-overlay").classList.remove("open");}
function closeUsageOutside(e){if(e.target===document.getElementById("usage-overlay"))closeUsageModal();}

function _usageMonthKey(offset){
  var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-offset);
  return d.toISOString().slice(0,7);
}
function _usageSumMonth(month,cb){
  fetch(FB+"/USAGE/"+month+".json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      var tot=0;
      if(d&&typeof d==="object") Object.keys(d).forEach(function(k){ if(d[k]&&d[k].b) tot+=Number(d[k].b)||0; });
      cb(tot);
    }).catch(function(){cb(null);});
}
function _usageFmt(b){
  if(b==null) return "?";
  var mb=b/1024/1024;
  return mb>=1?mb.toFixed(1)+" MB":(b/1024).toFixed(0)+" KB";
}
function _usageRender(){
  var el=document.getElementById("usage-content");
  var curM=_usageMonthKey(0), prevM=_usageMonthKey(1);
  _usageSumMonth(curM,function(curBytes){
    _usageSumMonth(prevM,function(prevBytes){
      var warnHtml="";
      if(curBytes!=null&&prevBytes){
        var growth=((curBytes-prevBytes)/prevBytes)*100;
        if(growth>50){
          warnHtml="<div style='background:rgba(240,80,80,.08);border:1px solid rgba(240,80,80,.3);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px;color:var(--red);font-weight:700;'>⚠️ इस महीने पिछले महीने से "+growth.toFixed(0)+"% ज़्यादा डेटा इस्तेमाल हुआ — असामान्य बढ़ोतरी, कारण जांचें</div>";
        }
      }
      el.innerHTML=warnHtml+
        "<table class='wasc-table'><thead><tr><th>महीना</th><th>अनुमानित डेटा (सभी devices)</th></tr></thead><tbody>"+
        "<tr><td>"+curM+" (चालू)</td><td>"+_usageFmt(curBytes)+"</td></tr>"+
        "<tr><td>"+prevM+"</td><td>"+_usageFmt(prevBytes)+"</td></tr>"+
        "</tbody></table>"+
        "<div style='font-size:10px;color:var(--muted);margin-top:8px;'>यह सिर्फ़ ऐप के अंदर पढ़े गए डेटा के आकार से बना अनुमान है, असली Firebase bill नहीं — सटीक राशि के लिए Firebase Console → Usage and billing देखें।</div>";
    });
  });
}
// 3 महीने से पुराने usage records अपने आप हटें — free plan की जगह न भरे (जैसे LOGS में होता है)
function _usageCleanupOld(){
  fetch(FB+"/USAGE.json?shallow=true&t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d)return;
      var cutoff=_usageMonthKey(3);
      Object.keys(d).forEach(function(m){
        if(m<cutoff) fetch(FB+"/USAGE/"+m+".json",{method:"DELETE"}).catch(function(){});
      });
    }).catch(function(){});
}
