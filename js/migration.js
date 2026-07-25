// ─── चरण 3 (per-record migration) — Dry-run जांच (सिर्फ JE) ───
// यह सिर्फ पढ़ता है, कुछ भी Firebase में नहीं लिखता। मकसद: असली माइग्रेशन से पहले पक्का करना
// कि हर HQ/श्रेणी में हर record का 'acc' मौजूद है, अलग-अलग है, और Firebase key बनने लायक है
// (Firebase key में . # $ [ ] / नहीं चल सकते) — तभी array→per-record बदलाव सुरक्षित होगा।
var MIG_REPORT = null;

function openMigModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE यह देख सकते हैं","err");return;}
  var mn=document.getElementById("logout-menu"); if(mn) mn.classList.remove("open");
  document.getElementById("mig-overlay").classList.add("open");
  document.getElementById("mig-content").innerHTML="<div class='log-empty'>ऊपर 'दोबारा जांचें' दबाकर dry-run शुरू करें</div>";
  document.getElementById("mig-dl").style.display="none";
}
function closeMigModal(){document.getElementById("mig-overlay").classList.remove("open");}

// एक HQ/श्रेणी की raw list (array या पहले से object) का विश्लेषण — कुछ भी नहीं लिखता
function _migAnalyzeList(raw){
  if(!raw) return {tot:0,missingAcc:0,dupAcc:0,dupSamples:[],illegalAcc:0,illegalSamples:[],alreadyObj:false};
  var isArr=Array.isArray(raw);
  var arr=(isArr?raw:Object.keys(raw).map(function(k){return raw[k];})).filter(Boolean);
  var seen={},dupSamples=[],illegalSamples=[],missingAcc=0,dupAcc=0,illegalAcc=0;
  arr.forEach(function(x){
    var acc=(x&&x.acc!=null)?String(x.acc).trim():"";
    if(!acc){missingAcc++;return;}
    if(/[.#$\[\]\/]/.test(acc)){illegalAcc++; if(illegalSamples.length<5)illegalSamples.push(acc);}
    if(seen[acc]){dupAcc++; if(dupSamples.length<5)dupSamples.push(acc);}
    else seen[acc]=1;
  });
  return {tot:arr.length,missingAcc:missingAcc,dupAcc:dupAcc,dupSamples:dupSamples,illegalAcc:illegalAcc,illegalSamples:illegalSamples,alreadyObj:!isArr};
}

function _migRunDryRun(){
  var el=document.getElementById("mig-content");
  el.innerHTML="<div class='log-empty'>⏳ सभी HQ/श्रेणी जांची जा रही हैं...</div>";
  document.getElementById("mig-dl").style.display="none";
  var jobs=[];
  HQS.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=(i>=4)?getCatName(hq,i):CATS_DEFAULT[i];
      jobs.push({hq:hq,cat:cat});
    }
  });
  var rows=[],done=0;
  jobs.forEach(function(j){
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        var a=_migAnalyzeList(d);
        rows.push({hq:j.hq,cat:j.cat,a:a});
        fin();
      })
      .catch(function(){
        rows.push({hq:j.hq,cat:j.cat,a:{tot:0,missingAcc:0,dupAcc:0,dupSamples:[],illegalAcc:0,illegalSamples:[],alreadyObj:false,fetchErr:true}});
        fin();
      });
  });
  function fin(){
    done++;
    if(done<jobs.length){el.innerHTML="<div class='log-empty'>⏳ जांच जारी — "+done+"/"+jobs.length+"...</div>";return;}
    // HQ/श्रेणी क्रम में सजाएं (जैसा jobs में था)
    var order={};jobs.forEach(function(j,i){order[j.hq+"|"+j.cat]=i;});
    rows.sort(function(a,b){return order[a.hq+"|"+a.cat]-order[b.hq+"|"+b.cat];});
    MIG_REPORT=rows;
    _migRender(rows);
  }
}

function _migRender(rows){
  var el=document.getElementById("mig-content");
  var gTot=0,gMiss=0,gDup=0,gIll=0,anyErr=false;
  rows.forEach(function(r){gTot+=r.a.tot;gMiss+=r.a.missingAcc;gDup+=r.a.dupAcc;gIll+=r.a.illegalAcc;if(r.a.fetchErr)anyErr=true;});
  var clean=(gMiss===0&&gDup===0&&gIll===0&&!anyErr);
  var html="";
  if(anyErr){
    html+="<div class='box-danger' style='background:#fdf0f1;border:1px solid #ecc8cc;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;'>⚠️ कुछ HQ/श्रेणी लोड नहीं हो पाईं (नेट/network) — दोबारा जांचें दबाएं।</div>";
  } else if(clean){
    html+="<div style='background:rgba(0,200,150,.08);border:1px solid rgba(0,200,150,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--green);font-weight:700;'>✅ सभी "+gTot+" records ठीक हैं — कोई acc missing/duplicate/illegal नहीं। माइग्रेशन के लिए तैयार।</div>";
  } else {
    html+="<div style='background:rgba(240,165,0,.08);border:1px solid rgba(240,165,0,.3);border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--gold2);font-weight:700;'>⚠️ पहले इन समस्याओं को ठीक करें — Missing acc: "+gMiss+", Duplicate acc: "+gDup+", अवैध acc: "+gIll+"</div>";
  }
  html+="<table class='wasc-table'><thead><tr><th>HQ</th><th>श्रेणी</th><th>कुल</th><th>Missing<br>acc</th><th>Duplicate<br>acc</th><th>अवैध<br>acc</th></tr></thead><tbody>";
  rows.forEach(function(r){
    var bad=r.a.missingAcc||r.a.dupAcc||r.a.illegalAcc||r.a.fetchErr;
    html+="<tr"+(bad?" style='background:rgba(240,80,80,.06);'":"")+"><td class='wasc-hq'>"+escHtml(r.hq)+"</td><td>"+escHtml(r.cat)+"</td>"+
      "<td>"+r.a.tot+"</td><td>"+(r.a.fetchErr?"—":r.a.missingAcc)+"</td><td>"+(r.a.fetchErr?"—":r.a.dupAcc)+"</td><td>"+(r.a.fetchErr?"—":r.a.illegalAcc)+"</td></tr>";
  });
  html+="</tbody><tfoot><tr><td colspan='2'>योग</td><td>"+gTot+"</td><td>"+gMiss+"</td><td>"+gDup+"</td><td>"+gIll+"</td></tr></tfoot></table>";
  el.innerHTML=html;
  document.getElementById("mig-dl").style.display=rows.length?"":"none";
}

function downloadMigReport(){
  if(!MIG_REPORT||!MIG_REPORT.length){toast("पहले जांच चलाएं","err");return;}
  ensureXLSX(function(ok){
    if(!ok){toast("📴 Excel के लिए इन्टरनेट चाहिए","err");return;}
    var rows=[["HQ","श्रेणी","कुल","Missing acc","Duplicate acc","अवैध acc","Duplicate नमूने","अवैध नमूने"]];
    MIG_REPORT.forEach(function(r){
      rows.push([r.hq,r.cat,r.a.tot,r.a.missingAcc,r.a.dupAcc,r.a.illegalAcc,(r.a.dupSamples||[]).join(", "),(r.a.illegalSamples||[]).join(", ")]);
    });
    var ws=XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:12},{wch:16},{wch:8},{wch:10},{wch:12},{wch:10},{wch:24},{wch:24}];
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"चरण3 Dry-run");
    XLSX.writeFile(wb,"ADEGAON_charan3_dryrun_"+new Date().toLocaleDateString("en-IN").replace(/\//g,"-")+".xlsx");
  });
}
