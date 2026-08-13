// ─── UPLOAD MODAL ────────────────────────────────────────────
function updateUpCounter(){
  var hq=document.getElementById("up-hq").value;
  var cat=document.getElementById("up-cat").value;
  var exist=0;
  if(hq&&cat) exist=cGet(hq,cat).length;
  var maxR=getMaxRecords(cat||activeCat);
  var avail=Math.max(0,maxR-exist);
  document.getElementById("cnt-exist").textContent=exist;
  document.getElementById("cnt-avail").textContent=avail;
  document.getElementById("cnt-avail").title="Limit: "+maxR;
  // file count if already parsed
  var fileWrap=document.getElementById("cnt-file-wrap");
  if(parsedRows.length){
    fileWrap.style.display="block";
    document.getElementById("cnt-file").textContent=parsedRows.length;
  } else {
    fileWrap.style.display="none";
  }
  // limit warning
  var lw=document.getElementById("cnt-limit-warn");
  lw.style.display=(exist>=maxR)?"block":"none";
  // disable upload if limit full and merge mode
  if(exist>=maxR && upMode==="merge"){
    document.getElementById("btn-up-ok").disabled=true;
    document.getElementById("btn-up-ok").style.opacity=".5";
  }
}

function openUpModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE लिस्ट अपलोड कर सकते हैं","err");return;}
  // Sync editable category names in upload dropdown
  var o4=document.getElementById("up-cat-4");
  var o5=document.getElementById("up-cat-5");
  var o6=document.getElementById("up-cat-6");
  var o7=document.getElementById("up-cat-7");
  if(o4){ o4.textContent=CATS[4]; o4.value=CATS[4]; }
  if(o5){ o5.textContent=CATS[5]; o5.value=CATS[5]; }
  if(o6){ o6.textContent=CATS[6]; o6.value=CATS[6]; }
  if(o7){ o7.textContent=CATS[7]; o7.value=CATS[7]; }
  var sel=document.getElementById("up-hq"); sel.innerHTML="";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  hqs.forEach(function(hq){var o=document.createElement("option");o.value=hq;o.textContent=hq;sel.appendChild(o);});
  sel.value=activeHQ;
  document.getElementById("up-cat").value=activeCat;
  var hint=document.getElementById("cat-hint");
  if(hint) hint.style.display="none";
  onCatChange();
  parsedRows=[];
  document.getElementById("uz-ico").textContent="📂";
  document.getElementById("uz-t").textContent="CSV या Excel फ़ाइल चुनें";
  document.getElementById("file-input").value="";
  document.getElementById("up-preview").style.display="none";
  document.getElementById("btn-up-ok").disabled=true;
  document.getElementById("btn-up-ok").style.opacity=".5";
  setUpMode("merge"); // DEFAULT: merge
  updateUpCounter();
  document.getElementById("up-overlay").classList.add("open");
}
function onCatChange(){
  var cat=document.getElementById("up-cat").value;
  var hint=document.getElementById("cat-hint");
  // कुल उपभोक्ता के लिए auto Replace mode
  if(cat==="कुल उपभोक्ता"||cat===CATS[0]){
    setUpMode("replace");
  }
  if(!hint) return;
  if(cat==="कुल उपभोक्ता"){
    hint.style.display="block";
    hint.innerHTML="👥 <b>कुल उपभोक्ता</b> — अधिकतम <b>3500</b> records | <b>Net Bill/Amount optional</b> है<br>"+
      "जरूरी columns: <b>Consumer No</b> और <b>Consumer Name</b> बस काफी है";
  } else if(cat==="सूची-2"||cat===CATS[6]){
    hint.style.display="block";
    hint.innerHTML="📋 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else if(cat==="सूची-3"||cat===CATS[7]){
    hint.style.display="block";
    hint.innerHTML="📌 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else if(cat){
    hint.style.display="block";
    hint.innerHTML="📂 <b>"+escHtml(cat)+"</b> — अधिकतम <b>1000</b> records | Consumer No, Name और Net Bill जरूरी";
  } else {
    hint.style.display="none";
  }
}
function closeUpModal(){document.getElementById("up-overlay").classList.remove("open");}
function closeUpOutside(e){if(e.target===document.getElementById("up-overlay"))closeUpModal();}
function setUpMode(m){
  upMode=m;
  document.getElementById("mode-rep").className="topt"+(m==="replace"?" sel-pending":"");
  document.getElementById("mode-mrg").className="topt"+(m==="merge"?" sel-blue":"");
  updateUpCounter();
}
function dOver(e){e.preventDefault();document.getElementById("up-zone").classList.add("drag");}
function dLeave(){document.getElementById("up-zone").classList.remove("drag");}
function dDrop(e){e.preventDefault();dLeave();handleFile(e.dataTransfer.files[0]);}

// हर नई फ़ाइल-selection का अपना token — बड़ी फ़ाइल (जैसे 3500 records वाली) पढ़ने में समय लगता है,
// उस बीच कोई दूसरी फ़ाइल चुन ली जाए तो पुराना (धीमा) पढ़ना बाद में पूरा होकर नए वाले को overwrite कर
// सकता था (जैसे Adegaon की फ़ाइल का data देर से आकर Pindrai के ऊपर चढ़ जाना) — असली bug यही था
var _handleFileToken=0;
function handleFile(f){
  if(!f)return;
  var myToken=++_handleFileToken;
  document.getElementById("uz-ico").textContent="⏳";
  document.getElementById("uz-t").textContent=f.name;
  var n=f.name.toLowerCase();
  var isXl=n.endsWith(".xlsx")||n.endsWith(".xls");
  if(isXl&&typeof XLSX==="undefined"){
    ensureLibs();
    toast("📴 Excel पढ़ने के लिए इन्टरनेट चाहिए — नेट आने पर दोबारा try करें","err");
    document.getElementById("uz-ico").textContent="📂";
    return;
  }
  if(!isXl&&typeof Papa==="undefined"){
    ensureLibs();
    toast("📴 CSV पढ़ने के लिए इन्टरनेट चाहिए — नेट आने पर दोबारा try करें","err");
    document.getElementById("uz-ico").textContent="📂";
    return;
  }
  if(isXl){
    var rd=new FileReader();
    rd.onload=function(e){
      if(myToken!==_handleFileToken)return; // इस बीच कोई नई फ़ाइल चुन ली गई — यह पुराना (stale) परिणाम है
      try{
        var wb=XLSX.read(e.target.result,{type:"array"});
        processRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:"",raw:false}));
      }catch(ex){logErr("excel-parse",ex,f.name);toast("Excel त्रुटि: "+ex.message,"err");}
    };
    rd.readAsArrayBuffer(f);
  } else {
    var rd2=new FileReader();
    rd2.onload=function(e){
      if(myToken!==_handleFileToken)return;
      var result=Papa.parse(e.target.result,{header:true,skipEmptyLines:true});
      if(result.data&&result.data.length) processRows(result.data);
      else toast("CSV में data नहीं मिला","err");
    };
    rd2.readAsText(f,"UTF-8");
  }
}

// Fuzzy column finder — case-insensitive, ignores spaces/symbols, partial match fallback
function fuzzyFind(k, patterns){
  // k = {normalized_header: value} where normalized = lowercase trimmed
  // First pass: exact alphanumeric match
  for(var pi=0;pi<patterns.length;pi++){
    var pNorm=patterns[pi].toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g,"");
    for(var ki in k){
      var kNorm=ki.replace(/[^a-z0-9\u0900-\u097f]/g,"");
      if(kNorm===pNorm) return k[ki]||"";
    }
  }
  // Second pass: partial match
  for(var pi2=0;pi2<patterns.length;pi2++){
    var pNorm2=patterns[pi2].toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g,"");
    for(var ki2 in k){
      var kNorm2=ki2.replace(/[^a-z0-9\u0900-\u097f]/g,"");
      if(kNorm2.length>2&&(kNorm2.indexOf(pNorm2)!==-1||pNorm2.indexOf(kNorm2)!==-1)) return k[ki2]||"";
    }
  }
  return "";
}

function processRows(rows){
  var valid=[],errors=[];
  var now=new Date();
  var dtStr=now.toLocaleString("hi-IN");
  rows.forEach(function(r,i){
    var k={};
    Object.keys(r).forEach(function(h){
      // normalize: lowercase, trim, collapse spaces — keep all chars for fuzzyFind
      var clean=h.toString().trim().toLowerCase();
      k[clean]=String(r[h]).trim();
    });
    var name=fuzzyFind(k,["consumername","consumer name","cname","name","naam","नाम"]).trim();
    var acc=fuzzyFind(k,["consumernumber","consumer number","consumerno","consumer no","accountno","account no","ivrs","ivrs no","ivrsno","consumerid","consumer id","acc","conno","con no"]).trim();
    var rawAmt=fuzzyFind(k,["netbill","net bill","netamt","net amt","netamount","net amount","amount","dues","arrear","arrears","balance","bill","बकाया","देय राशि"]).replace(/,/g,"").replace(/[₹\s]/g,"").trim();
    var phone=fuzzyFind(k,["mobileno","mobile no","mobile","mobilenumber","mobile number","phone","mob","contact","contactno","contact no","phoneno","phone no"]).trim();
    var addr=fuzzyFind(k,["address","addr","adress","add","village","gram","location","स्थान","पता","ग्राम"]).trim();
    var rem=fuzzyFind(k,["remark","remarks","note","notes","comment","comments","टिप्पणी"]).trim();
    var tariff=fuzzyFind(k,["tariff","tariffcode","tarrif","tarrifcode","tarifftype","tarifcode","टैरिफ"]).trim();
    var load=fuzzyFind(k,["load","sanctionedload","sanctioned load","connectedload","connected load","loadkw","लोड"]).trim();
    var unit=fuzzyFind(k,["unit","units","consumption","unitsconsumed","units consumed","यूनिट"]).trim();
    var lastPayDate=fuzzyFind(k,["lastpaiddate","last paid date","lastpaymentdate","last payment date","lastpaydate","last pay date","lastdate","last date","prevpaydate","prev pay date","previouspaymentdate","previous payment date","prevdate","prev date","paymentdate","payment date","piclatithe","पिछली तिथि","पिछला दिनांक"]).trim();
    var father=fuzzyFind(k,["fathername","father name","fname","pitaname","pita","fathernamme","fathrname","father","pitaji","f name","fathernam","पिता","पिता का नाम","पिताजी","guardian","guardianname","guardian name","husbandname","husband name","husband","fathersname","father's name","fath","pitanaam","pita naam","dadaname","dada name","fathername1","f_name","s/o","s.o","w/o","w.o","d/o","d.o","sonof","son of","wifeof","wife of","daughterof","daughter of","relation","relativename","relative name","paternalnm","fathernm","pitatype","पति","पिता/पति","पिताजी का नाम","अभिभावक","गार्जियन"]).trim();
    var lastPaidAmt=fuzzyFind(k,["lastpaidamt","last paid amt","lastpaid","last paid","lastamt","last amt","lastpaidamount","last paid amount","lastpaymentamt","last payment amt","lastpaymentamount","last payment amount","prevamt","prev amt","previousamt","previous amt","previouspaidamt","previous paid amt","prevpaid","prev paid","lastbill","last bill","previousbill","previous bill","पिछला भुगतान","पिछली राशि"]).replace(/,/g,"").replace(/[₹\s]/g,"").trim();
    // "कुल उपभोक्ता" में amount optional है
    var _upCat=document.getElementById("up-cat")?document.getElementById("up-cat").value:"";
    var amtOptional=(_upCat==="कुल उपभोक्ता"||_upCat===CATS[0]);

    var cleanAmt=rawAmt;
    // amount साफ करें — कॉमा, रुपया चिह्न, spaces हटाएं
    if(cleanAmt) cleanAmt=cleanAmt.replace(/,/g,"").replace(/[₹\s]/g,"").replace(/[^0-9.-]/g,"").trim();

    var rowOk=name&&acc&&(amtOptional||(cleanAmt&&!isNaN(cleanAmt)));
    if(!rowOk){
      errors.push({row:i+2, reason:!name?"नाम नहीं":!acc?"Consumer No नहीं":(!amtOptional&&!cleanAmt)?"राशि नहीं":"राशि गलत"});
    } else {
      var finalAmt=cleanAmt||"0";
      var entry={name:name,acc:acc,amount:finalAmt,phone:phone,addr:addr,father:father,remarks:rem,
        tariff:tariff,load:load,unit:unit,lastPayDate:lastPayDate,lastPaidAmt:lastPaidAmt,
        status:"pending",uploadedBy:CU.name,uploadedAt:dtStr,ts:Date.now(),remarksArr:[]};
      // बकाया 0 या minus हो तो अपने आप वसूल
      if(cleanAmt!=="" && !isNaN(cleanAmt) && Number(cleanAmt)<=0){
        entry.status="paid";
        entry.paydate=new Date().toLocaleDateString("hi-IN");
        entry.updatedBy=CU.name+" (बकाया ≤0 auto)";
        entry.updatedAt=dtStr;
      }
      if(rem) entry.remarksArr.push({text:rem,by:CU.name,at:dtStr});
      valid.push(entry);
    }
  });
  var _cat=document.getElementById("up-cat")?document.getElementById("up-cat").value:activeCat;
  parsedRows=valid.slice(0,getMaxRecords(_cat));
  document.getElementById("up-preview").style.display="block";
  var wb2=document.getElementById("up-warn");
  if(errors.length){
    wb2.style.display="block";
    var errMsg="⚠️ "+errors.length+" rows skip — ";
    var details=errors.slice(0,3).map(function(e){return "Row "+e.row+": "+e.reason;}).join(" | ");
    wb2.textContent=errMsg+details+(errors.length>3?" ...और "+(errors.length-3)+" rows":"");
  } else {
    wb2.style.display="none";
    wb2.textContent="";
  }
  document.getElementById("prev-title").textContent="पूर्वावलोकन ("+parsedRows.length+" records)";
  document.getElementById("prev-rows").innerHTML=parsedRows.slice(0,5).map(function(r,i){
    return "<div class='prev-row'><span class='pr-name'>"+(i+1)+". "+escHtml(r.name)+(r.father?" / "+escHtml(r.father):"")+"</span><span class='pr-acc'>"+escHtml(r.acc)+"</span><span class='pr-amt'>₹"+Number(r.amount).toLocaleString("hi-IN")+"</span></div>";
  }).join("");
  document.getElementById("uz-ico").textContent=parsedRows.length?"✅":"❌";
  document.getElementById("uz-t").textContent=parsedRows.length+" valid records";
  // Update counter with file info
  document.getElementById("cnt-file-wrap").style.display="block";
  document.getElementById("cnt-file").textContent=parsedRows.length;
  updateUpCounter();
  // Enable button if any valid records found
  var canUpload=parsedRows.length>0;
  document.getElementById("btn-up-ok").disabled=!canUpload;
  document.getElementById("btn-up-ok").style.opacity=canUpload?"1":".5";
}

function confirmUpload(){
  try{
    var hq=document.getElementById("up-hq").value;
    var cat=document.getElementById("up-cat").value;
    if(!hq){toast("HQ चुनें","err");return;}
    if(!cat){toast("Category चुनें","err");return;}
    if(!parsedRows||!parsedRows.length){toast("कोई valid डेटा नहीं — पहले file select करें","err");return;}
    
    var arr=parsedRows.slice(); // always use all parsed rows
    
    if(upMode==="merge"){
      var ex=cGet(hq,cat)||[];
      var _maxR=getMaxRecords(cat);
      if(ex.length>0){
        var merged=ex.slice();
        var added=0,dupes=0;
        arr.forEach(function(r){
          if(merged.find(function(e){return e.acc===r.acc;})){dupes++;}
          else if(merged.length<_maxR){merged.push(r);added++;}
        });
        arr=merged;
        var msg="✅ "+added+" नए जोड़े";
        if(dupes>0) msg+=" | "+dupes+" duplicate skip";
        msg+=" | कुल: "+arr.length+"/"+_maxR;
        _doSave(hq,cat,arr); toast(msg,"ok"); return;
      }
    }
    
    // Replace mode या पहली बार — पुरानी वसूली सुरक्षित रखें (checkbox on हो तो)
    var kept=0;
    var keepEl=document.getElementById("up-keeppaid");
    if(!keepEl||keepEl.checked){
      var exOld=cGet(hq,cat)||[];
      var paidByAcc={};
      exOld.forEach(function(e){
        if(e&&e.acc&&e.status==="paid"){
          paidByAcc[String(e.acc).trim()]={paydate:e.paydate||"",by:e.updatedBy||"",at:e.updatedAt||"",ts:e.ts||0,remarksArr:e.remarksArr||[]};
        }
      });
      // "हटाएं" के बाद upload हो रहा हो तो backup से भी वसूली वापस लें (7 दिन)
      try{
        var bkRaw=localStorage.getItem("vt_paidbk_"+cKey(hq,cat));
        if(bkRaw){
          var bkO=JSON.parse(bkRaw);
          if(Date.now()-(bkO.t||0)<604800000){
            Object.keys(bkO.m||{}).forEach(function(k){if(!paidByAcc[k])paidByAcc[k]=bkO.m[k];});
          }
        }
      }catch(e){}
      arr.forEach(function(r){
        var pm=paidByAcc[String(r.acc).trim()];
        if(pm&&r.status!=="paid"){
          r.status="paid";r.paydate=pm.paydate;
          if(pm.by){r.updatedBy=pm.by;r.updatedAt=pm.at;}
          if(pm.remarksArr&&pm.remarksArr.length)r.remarksArr=pm.remarksArr;
          r.ts=pm.ts||r.ts;kept++;
        }
      });
    }
    _doSave(hq,cat,arr);
    toast("✅ "+arr.length+" records अपलोड!"+(kept?" 🛡 "+kept+" पुरानी वसूली सुरक्षित":"")+" 🔥","ok");
    
  }catch(err){
    logErr("upload-confirm",err,activeHQ+"/"+(document.getElementById("up-cat")?document.getElementById("up-cat").value:""));
    toast("Error: "+err.message,"err");
    console.error("confirmUpload error:",err);
  }
}

function _doSave(hq,cat,arr){
  // fbSet को असली पुराना data चाहिए (patch-diff के लिए) — नीचे cSet से पहले ही निकाल लें
  var prevSnap=JSON.parse(JSON.stringify(cGet(hq,cat)||[]));
  // 1. Cache में save करें
  cSet(hq,cat,arr);
  // 2. Active HQ/Cat set करें
  activeHQ=hq;
  activeCat=cat;
  // 3. Modal पहले बंद करें
  document.getElementById("up-overlay").classList.remove("open");
  // 4. UI rebuild
  buildHQTabs();
  buildCatTabs();
  buildActionBtns();
  // 5. List और summary दिखाएं
  renderSummaryWith(arr);
  renderListWith(arr);
  // 6. Polling start
  startListen(activeHQ,activeCat);
  // 7. Firebase background save
  setTimeout(function(){
    fbSet(hq,cat,arr,prevSnap,function(ok){
      if(!ok) toast("⚠️ Firebase sync pending","inf");
    });
  },300);
}

function downloadExcel(){
  var data=cGet(activeHQ,activeCat);
  if(!data.length){toast("कोई data नहीं","err");return;}
  if(typeof XLSX==="undefined"){ensureLibs();toast("📴 Excel download के लिए इन्टरनेट चाहिए","err");return;}
  var rows=[["क्र.","नाम","पिता/पति","Consumer No","बकाया","Tariff","Load","Unit","Mobile","पता","स्थिति","भुगतान तिथि","पिछला भुगतान","पिछला तिथि","रिमार्क (सभी)","अपडेट by"]];
  data.forEach(function(x,i){
    var allRmk=(x.remarksArr||[]).map(function(r){return r.text+" ("+r.by+")";}).join(" | ");
    rows.push([i+1,x.name||"",x.father||"",x.acc||"",Number(x.amount)||0,x.tariff||"",x.load||"",x.unit||"",x.phone||"",x.addr||"",x.status==="paid"?"वसूल":"बाकी",x.paydate||"",x.lastPaidAmt||"",x.lastPayDate||"",allRmk,x.updatedBy||""]);
  });
  var ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[{wch:4},{wch:20},{wch:18},{wch:14},{wch:10},{wch:8},{wch:8},{wch:6},{wch:13},{wch:18},{wch:8},{wch:13},{wch:12},{wch:13},{wch:35},{wch:14}];
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,activeHQ+"_"+activeCat);
  XLSX.writeFile(wb,activeHQ+"_"+activeCat+"_"+new Date().toLocaleDateString("en-IN").replace(/\//g,"-")+".xlsx");
  toast("📊 Excel download!","ok");
}

function downloadPDF(){
  var data=cGet(activeHQ,activeCat);
  if(!data.length){toast("कोई data नहीं","err");return;}
  var paid=data.filter(function(x){return x.status==="paid";});
  var pending=data.filter(function(x){return x.status!=="paid";});
  var pendAmt=pending.reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  var paidAmt=paid.reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  var rows=data.map(function(x,i){
    var isPaid=x.status==="paid";
    var allRmk=(x.remarksArr||[]).map(function(r){return r.text+" <small>("+r.by+")</small>";}).join("<br>");
    return "<tr style='border-bottom:1px solid #ddd;background:"+(i%2===0?"#fff":"#f9f9f9")+";'>"+
      "<td style='padding:5px;text-align:center;'>"+(i+1)+"</td>"+
      "<td style='padding:5px;font-weight:600;'>"+x.name+"</td>"+
      "<td style='padding:5px;color:#555;'>"+(x.father||"-")+"</td>"+
      "<td style='padding:5px;color:#1565c0;'>"+x.acc+"</td>"+
      "<td style='padding:5px;color:#333;'>"+(x.phone||"-")+"</td>"+
      "<td style='padding:5px;text-align:right;font-weight:700;'>₹"+Number(x.amount).toLocaleString("hi-IN")+"</td>"+
      "<td style='padding:5px;'>"+(x.tariff||"-")+"</td>"+
      "<td style='padding:5px;'>"+(x.load||"-")+"</td>"+
      "<td style='padding:5px;text-align:center;font-weight:700;color:"+(isPaid?"#2e7d32":"#c62828")+"'>"+
        (isPaid?"✓ वसूल":"✗ बाकी")+(x.paydate?"<br><small>"+x.paydate+"</small>":"")+
      "</td>"+
      "<td style='padding:5px;background:"+(allRmk?"#fff8e1":"")+"'>"+(allRmk||"-")+"</td>"+
      "<td style='padding:5px;font-size:10px;color:#555;'>"+(x.lastPaidAmt?"₹"+x.lastPaidAmt+(x.lastPayDate?"<br>"+x.lastPayDate:""): "-")+"</td>"+
    "</tr>";
  }).join("");
  var html="<!DOCTYPE html><html><head><meta charset='UTF-8'>"+
    "<style>body{font-family:Arial,sans-serif;font-size:11px;margin:15px;}h2{color:#1a237e;}"+
    ".info{display:flex;gap:12px;flex-wrap:wrap;background:#f5f5f5;padding:8px;border-radius:6px;margin:8px 0;}"+
    ".ib{text-align:center;}.ib b{font-size:15px;display:block;}"+
    "table{width:100%;border-collapse:collapse;}th{background:#1a237e;color:#fff;padding:5px;}"+
    "@media print{.np{display:none}}</style></head><body>"+
    "<h2>Bandol DC वसूली रिपोर्ट</h2>"+
    "<p>HQ: <b>"+activeHQ+"</b> | Category: <b>"+activeCat+"</b> | दिनांक: <b>"+new Date().toLocaleDateString("hi-IN")+"</b> | "+CU.name+"</p>"+
    "<div class='info'>"+
      "<div class='ib'><b>"+data.length+"</b>कुल</div>"+
      "<div class='ib'><b style='color:green'>"+paid.length+"</b>वसूल</div>"+
      "<div class='ib'><b style='color:red'>"+pending.length+"</b>बाकी</div>"+
      "<div class='ib'><b style='color:green'>₹"+paidAmt.toLocaleString("hi-IN")+"</b>वसूल राशि</div>"+
      "<div class='ib'><b style='color:red'>₹"+pendAmt.toLocaleString("hi-IN")+"</b>बाकी राशि</div>"+
    "</div>"+
    "<button class='np' onclick='window.print()' style='margin-bottom:8px;padding:6px 14px;background:#1a237e;color:#fff;border:none;border-radius:5px;cursor:pointer;'>Print / PDF Save</button>"+
    "<table><thead><tr>"+
      "<th>#</th><th>नाम</th><th>पिता/पति</th><th>Consumer No</th><th>Mobile</th><th>बकाया</th><th>Tariff</th><th>Load</th><th>स्थिति</th><th>रिमार्क</th><th>पिछला भुगतान</th>"+
    "</tr></thead><tbody>"+rows+"</tbody></table></body></html>";
  var w=window.open("","_blank");
  if(w){w.document.write(html);w.document.close();setTimeout(function(){w.print();},600);}
  else toast("Popup block है, allow करें","inf");
}


