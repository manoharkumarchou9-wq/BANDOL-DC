function renderSummaryWith(data){
  var tot=0,paid=0,pend=0,pendAmt=0;
  data.forEach(function(c){tot++;if(c.status==="paid")paid++;else{pend++;pendAmt+=Number(c.amount)||0;}});
  var fmt=function(a){return a>=100000?"₹"+(a/100000).toFixed(1)+"L":a>=1000?"₹"+(a/1000).toFixed(1)+"K":"₹"+a;};
  document.getElementById("summary").innerHTML=
    "<div class='sbox'><div class='snum'>"+tot+"</div><div class='slbl'>"+activeCat+"</div></div>"+
    "<div class='sbox'><div class='snum'>"+paid+"</div><div class='slbl'>✓ वसूल</div></div>"+
    "<div class='sbox'><div class='snum'>"+pend+"</div><div class='slbl'>✗ बाकी</div></div>"+
    "<div class='sbox'><div class='snum'>"+fmt(pendAmt)+"</div><div class='slbl'>बाकी राशि</div></div>";
}

function setFilter(btn){
  activeFilter=btn.dataset.f;
  _renderLimit=100;
  document.querySelectorAll(".filter-btn").forEach(function(b){b.className="filter-btn";});
  btn.className="filter-btn active-"+activeFilter;
  // पहले cache से तुरंत दिखाएं
  var cached=cGet(activeHQ,activeCat);
  if(cached.length) renderListWith(cached);
  // फिर network refresh
  fbGet(activeHQ,activeCat,function(d){renderListWith(d);});
}
var _searchTimer=null;
function debounceSearch(){
  clearTimeout(_searchTimer);
  _searchTimer=setTimeout(function(){renderList();},250);
}
function renderList(){var d=cGet(activeHQ,activeCat);renderListWith(d);}
var _renderLimit=100;
function renderListWith(data){
  var q=(document.getElementById("search-inp").value||"").toLowerCase().trim();
  var c=document.getElementById("con-list");
  var filtered=data.filter(function(x){
    var qd=q.replace(/\D/g,"");
    var matchQ=!q||
      (x.name||"").toLowerCase().includes(q)||
      (x.acc||"").toLowerCase().includes(q)||
      (qd.length>=4&&(x.phone||"").replace(/\D/g,"").includes(qd))||
      (x.phone||"").toLowerCase().includes(q)||
      (x.addr||"").toLowerCase().includes(q)||
      (x.tariff||"").toLowerCase().includes(q)||
      (x.father||"").toLowerCase().includes(q);
    return matchQ&&(activeFilter==="all"||x.status===activeFilter);
  });
  if(!filtered.length){
    var emptyMsg;
    if(activeFilter==="paid") emptyMsg="अभी कोई वसूली दर्ज नहीं";
    else if(activeFilter==="pending") emptyMsg="सभी वसूली हो चुकी है!";
    else if(q) emptyMsg="कोई परिणाम नहीं";
    else emptyMsg="सूची खाली है";
    var emptyIco=activeFilter==="paid"?"✅":activeFilter==="pending"?"⏳":(q?"🔍":"📋");
    var emptySub=(!q&&activeFilter==="all")?"📤 अपलोड बटन से लिस्ट डालें":"🔍 खोज या फ़िल्टर बदलें";
    c.innerHTML="<div class='empty'><div class='empty-ico'>"+emptyIco+"</div>"+
      "<div class='empty-t'>"+emptyMsg+"</div>"+
      "<div class='empty-s'>"+emptySub+"</div></div>";
    return;
  }
  var toRender=filtered.slice(0,_renderLimit);
  var hasMore=filtered.length>_renderLimit;
  c.innerHTML=toRender.map(function(x){
    var oi=data.indexOf(x),isPaid=x.status==="paid";
    var remarksArr=x.remarksArr||[];
    var rmkHtml="";
    if(remarksArr.length){
      rmkHtml="<div class='cc-rmk-list'>";
      remarksArr.slice().reverse().forEach(function(r){
        rmkHtml+="<div class='cc-rmk-item'><span>💬 "+escHtml(r.text)+"</span><span class='cc-rmk-by'>— "+escHtml(r.by)+(r.at?" • "+r.at:"")+"</span></div>";
      });
      rmkHtml+="</div>";
    }
    var uploadInfo="";
    if(x.updatedBy&&x.updatedAt) uploadInfo="<span class='cc-upload-info'>🔄 अपडेट: "+escHtml(x.updatedBy)+" • "+escHtml(x.updatedAt)+"</span>";
    else if(x.uploadedBy&&x.uploadedAt) uploadInfo="<span class='cc-upload-info'>📤 अपलोड: "+escHtml(x.uploadedBy)+" • "+escHtml(x.uploadedAt)+"</span>";
    var prevPayInfo="";
    if(x.lastPaidAmt&&x.lastPaidAmt.toString().trim()!==""){
      var lastAmtNum=Number(x.lastPaidAmt);
      prevPayInfo="<span style='color:#7986cb;'>📅 पिछला भुगतान: ₹"+(isNaN(lastAmtNum)?x.lastPaidAmt:lastAmtNum.toLocaleString("hi-IN"))+(x.lastPayDate?" ("+escHtml(x.lastPayDate)+")":"")+"</span>";
    } else if(x.lastPayDate&&x.lastPayDate.trim()){
      prevPayInfo="<span style='color:#7986cb;'>📅 पिछला भुगतान तिथि: "+escHtml(x.lastPayDate)+"</span>";
    }
    var payDateInfo=x.paydate?"<span class='cc-paydate'>💰 वसूल: "+escHtml(x.paydate)+"</span>":"";
    return "<div class='con-card "+(isPaid?"paid":"pending")+"'>"+
      "<div class='cc-top'><div class='cc-name'>"+escHtml(x.name)+(x.father?" / "+escHtml(x.father):"")+"</div><div class='cc-rank'>#"+(oi+1)+"</div></div>"+
      "<div class='cc-amt'>₹"+Number(x.amount).toLocaleString("hi-IN")+" <span>बकाया</span></div>"+
      "<div class='cc-chips'>"+
        (x.acc?"<span class='chip chip-acc' onclick=\"openAccModal('"+escHtml(x.acc)+"')\">📄 "+escHtml(x.acc)+"</span>":"")+
                (x.phone?"<span class='chip chip-ph' style='cursor:pointer;' onclick=\"openPhModal('"+escHtml(x.name)+"','"+escHtml(x.phone)+"','"+escHtml(x.acc||"")+"','"+(Number(x.amount)||0)+"')\">📞 "+escHtml(x.phone)+"</span>":"")+
        (x.addr?"<span class='chip chip-addr'>📍 "+escHtml(x.addr)+"</span>":"")+
      "</div>"+
      "<div class='cc-extra'>"+
        (x.tariff?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(255,152,0,.12);color:#ffb74d;'>⚡ "+escHtml(x.tariff)+"</span>":"")+
        (x.load?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(33,150,243,.1);color:#64b5f6;'>🔌 "+escHtml(x.load)+"</span>":"")+
        (x.unit?"<span style='font-size:10px;padding:2px 7px;border-radius:12px;background:rgba(0,200,150,.08);color:#4db6ac;'>📊 "+escHtml(x.unit)+"</span>":"")+
      "</div>"+
      "<div class='cc-bot'><span class='sbadge "+(isPaid?"sb-paid":"sb-pending")+"'>"+(isPaid?"✅ वसूल":"⏳ बाकी")+"</span>"+
      "<div class='act-btns'>"+
        "<button class='abtn abtn-rmk' onclick=\"openRmkModal("+oi+",'"+escHtml(x.acc||"")+"')\">✏️ रिमार्क</button>"+
        (!isPaid?"<button class='abtn abtn-pay' onclick=\"markPaid("+oi+",'"+escHtml(x.acc||"")+"')\">✓ वसूल</button>":
                 "<button class='abtn' style='background:rgba(255,77,109,.12);color:var(--red);border:1px solid rgba(255,77,109,.2);' onclick=\"markUnpaid("+oi+",'"+escHtml(x.acc||"")+"')\">↩ वापस बाकी</button>")+
      "</div></div>"+
      "<div class='cc-info'>"+prevPayInfo+payDateInfo+uploadInfo+"</div>"+
      rmkHtml+"</div>";
  }).join("")+
  (hasMore?"<div style='text-align:center;padding:14px 0 60px;'><button onclick='_renderLimit+=100;renderListWith(cGet(activeHQ,activeCat));' style='border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:10px 22px;font-family:\"Noto Sans Devanagari\",sans-serif;font-size:12px;cursor:pointer;'>⬇ और दिखाएं ("+toRender.length+"/"+filtered.length+")</button></div>":"");
}

function escHtml(s){
  if(!s) return "";
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── एक IVRS/acc का status उस HQ की हर tab में sync ──
// ── हाल के status बदलावों का log — stale sync से वसूली उड़ने से बचाव ──
function _getOps(){try{return JSON.parse(localStorage.getItem("vt_ops")||"{}");}catch(e){return {};}}
function _setOps(o){try{localStorage.setItem("vt_ops",JSON.stringify(o));}catch(e){}}
function recOp(hq,acc,status,paydate,by,at,ts){
  if(!hq||!acc)return;
  var o=_getOps(),now=Date.now();
  Object.keys(o).forEach(function(k){if(now-(o[k].ts||0)>172800000)delete o[k];}); // 48h prune
  o[hq+"|"+String(acc).trim()]={status:status,paydate:paydate||"",by:by||"",at:at||"",ts:ts||now};
  _setOps(o);
}
var _opPushT={};
// बकाया ≤0 auto-fix से बदले records — debounce window में जमा होकर migrated HQ/श्रेणी पर सिर्फ
// इन्हीं का PATCH भेजा जाता है (पूरी array दोबारा नहीं) — हर hq|cat की अपनी अलग जमा-सूची
var _autoFixPatch={}, _autoFixUnsafe={};
function overlayOps(hq,cat,data){
  var o=_getOps(),applied=0;
  data.forEach(function(x){
    if(!x||!x.acc)return;
    var op=o[hq+"|"+String(x.acc).trim()];
    if(op&&(op.ts||0)>(x.ts||0)&&x.status!==op.status){
      x.status=op.status;x.paydate=op.paydate||"";
      if(op.by){x.updatedBy=op.by;x.updatedAt=op.at;}
      x.ts=op.ts;applied++;
    }
  });
  var key=hq+"|"+cat;
  // बकाया 0 या minus (advance) वाले records अपने आप वसूल — पुराने records पर भी, हमेशा जांचा जाता है
  data.forEach(function(x){
    if(!x||x.status==="paid")return;
    var amt=(x.amount===undefined||x.amount===null)?"":String(x.amount).trim();
    if(amt===""||isNaN(Number(amt)))return;
    if(Number(amt)<=0){
      var now=new Date();
      x.status="paid";
      x.paydate=now.toLocaleDateString("hi-IN");
      x.updatedBy="System (बकाया ≤0 auto)";
      x.updatedAt=now.toLocaleString("hi-IN");
      x.ts=Date.now();
      applied++;
      if(x.acc){ _autoFixPatch[key]=_autoFixPatch[key]||{}; _autoFixPatch[key][String(x.acc)]=x; }
      else _autoFixUnsafe[key]=true; // acc नहीं — patch-key नहीं बन सकता, सुरक्षित array-PUT पर वापस
    }
  });
  if(applied){
    clearTimeout(_opPushT[key]);
    _opPushT[key]=setTimeout(function(){
      var patch=_autoFixPatch[key],unsafe=_autoFixUnsafe[key];
      delete _autoFixPatch[key]; delete _autoFixUnsafe[key];
      // migrated HQ/श्रेणी हो और सभी बदले records का acc मिल गया हो — सिर्फ उन्हीं को PATCH करें
      // (पूरी array PUT करने से चरण 3 का migration यहीं से पलट सकता था — यही असली bug था)
      if(isMigrated(hq,cat)&&!unsafe&&patch&&Object.keys(patch).length){
        fetch(FB+"/"+fbPath(hq,cat)+".json",{
          method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)
        }).catch(function(e){logErr("autopay-patch-fail",e,hq+"/"+cat);});
      } else {
        _fbPut(hq,cat,cGet(hq,cat),null);
      }
    },1500);
  }
  return applied;
}
function propagateStatus(acc,srcCat,status,paydate,dtStr,ts){
  if(!acc) return;
  recOp(activeHQ,acc,status,paydate,CU&&CU.name||"",dtStr,ts);
  for(var i=0;i<CATS_DEFAULT.length;i++){
    var cat=(i>=4)?getCatName(activeHQ,i):CATS_DEFAULT[i];
    if(cat===srcCat) continue;
    var d=cGet(activeHQ,cat);
    if(!d||!d.length) continue;
    var prevSnap=JSON.parse(JSON.stringify(d));
    var changed=false;
    d.forEach(function(x){
      if(x&&x.acc&&String(x.acc).trim()===String(acc).trim()&&x.status!==status){
        x.status=status;
        x.paydate=(status==="paid")?paydate:"";
        x.updatedBy=CU.name; x.updatedAt=dtStr; x.ts=ts;
        changed=true;
      }
    });
    if(changed){ cSet(activeHQ,cat,d); fbSet(activeHQ,cat,d,prevSnap,null); }
  }
}

// ── पुराने mismatch ठीक करें: किसी भी tab में paid → हर tab में paid ──
function reconcileHQ(hq){
  var cats=[];
  for(var i=0;i<CATS_DEFAULT.length;i++) cats.push((i>=4)?getCatName(hq,i):CATS_DEFAULT[i]);
  var paidMap={};
  cats.forEach(function(cat){
    cGet(hq,cat).forEach(function(x){
      if(x&&x.acc&&x.status==="paid"){
        var key=String(x.acc).trim();
        if(!paidMap[key]||((x.ts||0)>(paidMap[key].ts||0)))
          paidMap[key]={paydate:x.paydate||"",by:x.updatedBy||"",at:x.updatedAt||"",ts:x.ts||0};
      }
    });
  });
  var fixed=0;
  cats.forEach(function(cat){
    var d=cGet(hq,cat); var changed=false;
    var prevSnap=JSON.parse(JSON.stringify(d));
    d.forEach(function(x){
      if(x&&x.acc&&x.status!=="paid"&&paidMap[String(x.acc).trim()]){
        var pm=paidMap[String(x.acc).trim()];
        x.status="paid"; x.paydate=pm.paydate;
        if(pm.by){x.updatedBy=pm.by;x.updatedAt=pm.at;}
        x.ts=Date.now();
        changed=true; fixed++;
      }
    });
    if(changed){ cSet(hq,cat,d); fbSet(hq,cat,d,prevSnap,null); }
  });
  return fixed;
}

// idx सिर्फ़ पिछले render के वक्त की स्थिति है — इस बीच background sync से लिस्ट बदल/छोटी हो सकती है
// (जैसे रिमार्क मोडल खुला रहते हुए टाइप करने में लगने वाला वक्त)। इसलिए acc (स्थिर पहचान) से
// पहले ढूंढें, सिर्फ़ acc न मिले (जैसे acc-रहित पुराना record) तभी idx पर भरोसा करें
function _findRecordIdx(d,idx,acc){
  if(acc){
    for(var i=0;i<d.length;i++){
      if(d[i]&&d[i].acc!=null&&String(d[i].acc).trim()===String(acc).trim()) return i;
    }
    return -1; // acc दिया गया था पर अब लिस्ट में नहीं मिला — पुराने idx पर भरोसा करना और खतरनाक होगा
  }
  return d[idx]?idx:-1;
}
function markPaid(idx,acc){
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  var now=new Date();
  var dateStr=now.toLocaleDateString("hi-IN");
  var dtStr=now.toLocaleString("hi-IN");
  d[idx].status="paid";
  d[idx].paydate=dateStr;
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=Date.now();
  cSet(activeHQ,activeCat,d);
  renderSummaryWith(d); renderListWith(d);
  toast("✅ वसूली दर्ज! (हर tab में अपडेट)","ok");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,"paid",dateStr,dtStr,d[idx].ts);
}

function markUnpaid(idx,acc){
  if(!confirm("क्या वाकई इस उपभोक्ता की वसूली वापस 'बाकी' करनी है?")) return;
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  var dtStr=new Date().toLocaleString("hi-IN");
  d[idx].status="pending";
  d[idx].paydate="";
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=Date.now();
  cSet(activeHQ,activeCat,d);
  renderSummaryWith(d); renderListWith(d);
  toast("↩ वापस बाकी किया — "+d[idx].name+" (हर tab में)","inf");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,"pending","",dtStr,d[idx].ts);
}

function clearList(){
  if(!confirm(activeHQ+" › "+activeCat+" की लिस्ट हटाएं?"))return;
  cSet(activeHQ,activeCat,[]);
  renderSummaryWith([]); renderListWith([]);
  toast("🗑️ लिस्ट हटाई गई","inf");
  fbDel(activeHQ,activeCat,null);
}

function openRmkModal(idx,acc){
  var d=cGet(activeHQ,activeCat);
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("यह रिकॉर्ड अब सूची में नहीं मिला — सूची ताज़ा हो गई होगी, दोबारा कोशिश करें","err");return;}
  var x=d[idx]; if(!x)return;
  x=migrateRemarks(x);
  document.getElementById("rmk-key").value=idx;
  document.getElementById("rmk-acc-key").value=x.acc||"";
  document.getElementById("rmk-name").textContent=x.name;
  document.getElementById("rmk-amt").textContent="₹"+Number(x.amount).toLocaleString("hi-IN")+" बकाया";
  document.getElementById("rmk-acc").textContent="Consumer No: "+x.acc+(x.father?" | पिता/पति: "+x.father:"");
  // New remark textarea always empty
  document.getElementById("rmk-text").value="";
  (function(){
    var t=new Date();
    var iso=t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");
    var pdEl=document.getElementById("rmk-paydate");
    pdEl.max=iso;
    // stored value ISO हो तो input में दिखाएँ, d/m/y हो तो convert
    var v=x.paydate||"";
    if(/^\d{4}-\d{2}-\d{2}$/.test(v)){pdEl.value=v;}
    else if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)){
      var pr=v.split("/");
      pdEl.value=pr[2]+"-"+pr[1].padStart(2,"0")+"-"+pr[0].padStart(2,"0");
    } else {pdEl.value="";}
  })();
  setRmkStatus(x.status||"pending");
  // Show previous remarks
  var arr=x.remarksArr||[];
  var sec=document.getElementById("prev-rmk-section");
  var lst=document.getElementById("prev-rmk-list");
  var cnt=document.getElementById("prev-rmk-count");
  if(arr.length){
    cnt.textContent=arr.length;
    var html=arr.slice().reverse().map(function(r){
      return "<div class='prev-rmk-item'>"+
        "<div class='prev-rmk-text'>💬 "+escHtml(r.text)+"</div>"+
        "<div class='prev-rmk-meta'>— "+escHtml(r.by)+(r.at?" • "+r.at:"")+"</div>"+
      "</div>";
    }).join("");
    lst.innerHTML=html;
    sec.style.display="block";
  } else {
    sec.style.display="none";
  }
  document.getElementById("rmk-overlay").classList.add("open");
}
function closeRmkModal(){document.getElementById("rmk-overlay").classList.remove("open");}
function closeRmkOutside(e){if(e.target===document.getElementById("rmk-overlay"))closeRmkModal();}
function setRmkStatus(s){
  rmkStatus=s;
  document.getElementById("rs-pending").className="topt"+(s==="pending"?" sel-pending":"");
  document.getElementById("rs-paid").className="topt"+(s==="paid"?" sel-paid":"");
  document.getElementById("rmk-paydate-grp").style.display=s==="paid"?"block":"none";
}
function saveRmk(){
  var idx=parseInt(document.getElementById("rmk-key").value);
  var acc=document.getElementById("rmk-acc-key").value;
  var d=cGet(activeHQ,activeCat);
  // मोडल खुला रहते हुए (टाइप करने के दौरान) background sync से लिस्ट बदल/छोटी हो सकती थी —
  // acc से दोबारा सही record ढूंढें, सिर्फ़ idx पर भरोसा न करें (वरना गलत record में सेव होने
  // या पूरी तरह चुपचाप fail होने का खतरा था — असली bug यही था)
  idx=_findRecordIdx(d,idx,acc);
  if(idx<0){toast("⚠ यह रिकॉर्ड अब सूची में नहीं मिला — मोडल बंद करके दोबारा कोशिश करें","err");return;}
  var prevSnap=JSON.parse(JSON.stringify(d));
  d[idx]=migrateRemarks(d[idx]);
  var now=new Date();
  var dtStr=now.toLocaleString("hi-IN");
  d[idx].status=rmkStatus;
  if(rmkStatus==="paid"){
    var pdv=document.getElementById("rmk-paydate").value; // yyyy-mm-dd from date input
    if(pdv){
      var pdd=new Date(pdv+"T00:00:00");
      var tdy=new Date(); tdy.setHours(0,0,0,0);
      if(isNaN(pdd.getTime())||pdd>tdy) pdd=tdy; // future/गलत date → आज
      d[idx].paydate=pdd.getDate()+"/"+(pdd.getMonth()+1)+"/"+pdd.getFullYear();
    } else {
      d[idx].paydate=now.toLocaleDateString("hi-IN");
    }
  }
  var newText=document.getElementById("rmk-text").value.trim();
  if(newText){
    if(!d[idx].remarksArr) d[idx].remarksArr=[];
    d[idx].remarksArr.push({text:newText,by:CU.name,at:dtStr});
    // Keep backward-compat field as latest remark text
    d[idx].remarks=newText;
  }
  d[idx].updatedBy=CU.name;
  d[idx].updatedAt=dtStr;
  d[idx].ts=Date.now();
  cSet(activeHQ,activeCat,d);
  closeRmkModal();
  renderSummaryWith(d); renderListWith(d);
  var total=(d[idx].remarksArr||[]).length;
  toast("✅ रिमार्क सेव! (कुल "+total+")","ok");
  fbSet(activeHQ,activeCat,d,prevSnap,null);
  propagateStatus(d[idx].acc,activeCat,rmkStatus,d[idx].paydate||"",dtStr,d[idx].ts);
}

