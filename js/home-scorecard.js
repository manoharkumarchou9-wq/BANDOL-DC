// ─── HOME SCORECARD: JE फोटो upload करे, सबके होम (login) पेज पर दिखे ───
var HSC=null;
function hscLoadLocal(){try{var x=localStorage.getItem("dc_homesc3");if(x)HSC=JSON.parse(x);}catch(e){}}
// publish fail हुआ हो तो flag — server का पुराना data local नए board को overwrite न करे
var HSC_PENDING_KEY="dc_hscpending3";
function _hscPending(){try{return localStorage.getItem(HSC_PENDING_KEY)==="1";}catch(e){return false;}}
function _setHscPending(v){try{if(v)localStorage.setItem(HSC_PENDING_KEY,"1");else localStorage.removeItem(HSC_PENDING_KEY);}catch(e){}}
function _hscAdopt(d){
  HSC=d;try{localStorage.setItem("dc_homesc3",JSON.stringify(d));}catch(e){}
  _setHscPending(false);renderHomeSc();
}
// publish से पहले server से मिलान — हमेशा नया (बड़ा ts) जीतता है, पुराना device नए को कभी नहीं मिटा सकता
function _hscRetryPublish(){
  if(!HSC||!navigator.onLine)return;
  fetch(FB+"/HOME_SCORECARD.json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(srv){
      if(srv&&typeof srv==="object"&&Number(srv.ts||0)>Number(HSC.ts||0)){_hscAdopt(srv);return;} // server नया है — उसे अपनाओ
      return fetch(FB+"/HOME_SCORECARD.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(HSC)})
        .then(function(r){if(r.ok){_setHscPending(false);toast("✅ डिस्प्ले बोर्ड अब प्रकाशित हो गया","ok");}});
    })
    .catch(function(){});
}
function hscFetch(){
  if(_hscPending()){_hscRetryPublish();return;} // local बोर्ड नया है — पहले उसे प्रकाशित करने की कोशिश
  fetch(FB+"/HOME_SCORECARD.json?t="+Date.now())
    .then(function(r){return r.json();})
    .then(function(d){
      if(d&&typeof d==="object"){
        // local, server से नया हो (कहीं से पुराना data server पर चढ़ गया) — local रखो और उसे दोबारा प्रकाशित करो
        if(HSC&&Number(HSC.ts||0)>Number(d.ts||0)){logErr("hsc-conflict",new Error("server stale — republishing"));_setHscPending(true);_hscRetryPublish();return;}
        HSC=d;try{localStorage.setItem("dc_homesc3",JSON.stringify(d));}catch(e){}renderHomeSc();
      }
    }).catch(function(){});
}
function fmtL(n){n=Number(n)||0;return n.toLocaleString("en-IN");}
var BRD_COL={crpu:false,eff:false};
try{var _bc=localStorage.getItem("dc_brdcol3");if(_bc)BRD_COL=JSON.parse(_bc);}catch(e){}
function toggleBoard(k){BRD_COL[k]=!BRD_COL[k];try{localStorage.setItem("dc_brdcol3",JSON.stringify(BRD_COL));}catch(e){}renderHomeSc();}
function renderHomeSc(){
  var el=document.getElementById("home-sc");
  if(!el)return;
  // showBoard="0" यानी JE ने पूरा डिस्प्ले बोर्ड होम पेज से हटाने का चुनाव किया है — पुराने बोर्ड
  // (जिनमें यह field ही नहीं) पहले जैसे दिखते रहें, इसलिए सिर्फ़ "0" पर ही छुपाएं, undefined पर नहीं
  if(!HSC||HSC.showBoard==="0"){el.innerHTML="";return;}
  var cp=Number(HSC.curPaid)||0,lp=Number(HSC.lyPaid)||0;
  var ca=Number(HSC.curAmt)||0,la=Number(HSC.lyAmt)||0;
  var dp=cp-lp, da=ca-la;
  var dpPct=lp?((dp/lp)*100).toFixed(2):"0.00", daPct=la?((da/la)*100).toFixed(2):"0.00";
  var g="var(--green)",r="var(--red)";
  var tgt=Number(HSC.pbiTgt)||0,cd2=Number(HSC.cashDem)||0,lyf=Number(HSC.lyFull)||0,gr=Number(HSC.growth)||25;
  var proHtml="";
  if(tgt>0||cd2>0){
    proHtml+="<div style='margin-top:8px;'>";
    [[tgt,"🎯 Power BI टारगेट"+(HSC.pbiMonth?" ("+escHtml(HSC.pbiMonth)+")":""),"#64b5f6"],[cd2,"🧾 कैश डिमांड (Current Month)","#4db6ac"]].forEach(function(it){
      if(!it[0])return;
      var p=(ca/it[0])*100;
      proHtml+="<div style='margin-bottom:8px;'>"+
        "<div style='display:flex;justify-content:space-between;align-items:baseline;font-size:10px;color:var(--muted);'><span>"+it[1]+" — &#8377;"+it[0]+" L</span><b style='font-size:14px;color:"+(p>=90?"var(--green)":(p>=60?"var(--gold2)":"var(--red)"))+";'>"+p.toFixed(1)+"%</b></div>"+
        "<div style='height:8px;background:rgba(255,255,255,.07);border-radius:5px;overflow:hidden;margin-top:3px;'><div style='height:100%;width:"+Math.min(p,100).toFixed(1)+"%;background:"+it[2]+";border-radius:5px;'></div></div>"+
      "</div>";
    });
    proHtml+="</div>";
  }
  var grHtml="";
  if(lyf>0){
    var gTgt=lyf*(1+gr/100),need=Math.max(0,gTgt-ca);
    grHtml="<div style='background:rgba(240,165,0,.07);border:1px solid rgba(240,165,0,.25);border-radius:10px;padding:9px 10px;margin-top:8px;'>"+
      "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);'><span>💰 गत वर्ष पूरा माह"+(HSC.growMonth?" — "+escHtml(HSC.growMonth):"")+" (आखिरी तारीख तक)</span><b style='color:var(--text);'>&#8377;"+lyf+" L</b></div>"+
      "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:3px;'><span>"+gr+"% Growth लक्ष्य</span><b style='color:var(--gold2);'>&#8377;"+gTgt.toFixed(2)+" L</b></div>"+
      "<div style='text-align:center;margin-top:7px;background:rgba(240,165,0,.12);border-radius:8px;padding:7px;'>"+
        (need>0?"<div style='font-family:\"Baloo 2\",cursive;font-size:18px;font-weight:800;color:var(--gold2);'>&#8377;"+need.toFixed(2)+" Lakh</div><div style='font-size:9px;color:var(--muted);'>"+gr+"% growth के लिए अभी और लाना है</div>"
               :"<div style='font-family:\"Baloo 2\",cursive;font-size:16px;font-weight:800;color:var(--green);'>🎉 Growth लक्ष्य पूरा!</div>")+
      "</div></div>";
  }
  var cntHtml="";
  var lyfp=Number(HSC.lyFullPaid)||0, cgr=Number(HSC.cntGrowth)||25, cp2=Number(HSC.curPaid)||0;
  if(lyfp>0){
    var cTgt=Math.ceil(lyfp*(1+cgr/100)), cNeed=Math.max(0,cTgt-cp2);
    cntHtml="<div style='background:rgba(100,181,246,.07);border:1px solid rgba(100,181,246,.25);border-radius:10px;padding:9px 10px;margin-top:8px;'>"+
      "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);'><span>👥 गत वर्ष इसी माह कुल Paid Consumers"+(HSC.growMonth?" — "+escHtml(HSC.growMonth):"")+"</span><b style='color:var(--text);'>"+lyfp.toLocaleString("en-IN")+"</b></div>"+
      "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:3px;'><span>"+cgr+"% Growth लक्ष्य</span><b style='color:#64b5f6;'>"+cTgt.toLocaleString("en-IN")+" consumers</b></div>"+
      "<div style='display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:3px;'><span>अब तक जमा कर चुके</span><b style='color:var(--text);'>"+cp2.toLocaleString("en-IN")+"</b></div>"+
      "<div style='text-align:center;margin-top:7px;background:rgba(100,181,246,.12);border-radius:8px;padding:7px;'>"+
        (cNeed>0?"<div style='font-family:\"Baloo 2\",cursive;font-size:18px;font-weight:800;color:#64b5f6;'>"+cNeed.toLocaleString("en-IN")+" उपभोक्ता</div><div style='font-size:9px;color:var(--muted);'>"+cgr+"% growth के लिए और जमा कराने हैं</div>"
                :"<div style='font-family:\"Baloo 2\",cursive;font-size:16px;font-weight:800;color:var(--green);'>🎉 Count लक्ष्य पूरा!</div>")+
      "</div></div>";
  }
  var crpuHtml="";
  var cc=Number(HSC.cumColl)||0,ci=Number(HSC.cumInput)||0,ct=Number(HSC.crpuTgt)||0;
  var buC=Number(HSC.bldUnits)||0, crpuDen=buC>0?buC:ci, crpuDenLbl=buC>0?"÷ Billed Units":"÷ Input";
  if(cc>0&&crpuDen>0&&HSC.showCrpu!=="0"){
    var crpu=cc/crpuDen;
    var needColl=ct>0?Math.max(0,ct*crpuDen-cc):0;
    crpuHtml="<div style='background:rgba(121,134,203,.08);border:1px solid rgba(121,134,203,.3);border-radius:10px;padding:10px;margin-top:8px;'>"+
      "<div onclick=\"toggleBoard('crpu')\" style='display:flex;justify-content:space-between;align-items:center;cursor:pointer;"+(BRD_COL.crpu?"":"margin-bottom:7px;")+"'>"+
        "<div style='font-size:11px;font-weight:700;color:#9fa8da;'>⚡ CRPU बोर्ड</div>"+
        "<div style='font-size:9px;color:var(--muted);'>FY 26-27 &bull; अप्रैल से अब तक <b style='color:#9fa8da;font-size:13px;'>"+(BRD_COL.crpu?"▸":"▾")+"</b></div>"+
      "</div>"+(BRD_COL.crpu?"":
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:center;'>"+
        "<div style='text-align:center;background:rgba(121,134,203,.12);border-radius:8px;padding:8px 4px;'>"+
          "<div style='font-size:9px;color:var(--muted);'>CRPU (अब तक)</div>"+
          "<div style='font-family:\"Baloo 2\",cursive;font-size:22px;font-weight:800;color:#9fa8da;'>&#8377;"+crpu.toFixed(2)+"</div>"+
          "<div style='font-size:9px;color:var(--muted);'>प्रति यूनिट ("+crpuDenLbl+")</div>"+
        "</div>"+
        "<div style='text-align:center;'>"+
          (ct>0?"<div style='font-size:9px;color:var(--muted);'>Target Projection</div>"+
          "<div style='font-family:\"Baloo 2\",cursive;font-size:16px;font-weight:800;color:var(--text);'>&#8377;"+ct.toFixed(2)+"</div>"+
          (crpu<ct?"<div style='font-family:\"Baloo 2\",cursive;font-size:15px;font-weight:800;color:var(--gold2);margin-top:2px;'>&#8377;"+needColl.toFixed(2)+" Lakh</div>"+
                   "<div style='font-size:9px;color:var(--red);'>वसूली और चाहिए</div>"
                  :"<div style='font-size:11px;font-weight:800;color:var(--green);margin-top:3px;'>✅ Target प्राप्त</div>")
          :"<div style='font-size:10px;color:var(--muted);'>Target नहीं भरा गया</div>")+
        "</div>"+
      "</div>"+
      "<div style='font-size:10px;color:var(--muted);margin-top:6px;background:rgba(255,209,102,.06);border:1px solid rgba(255,209,102,.18);border-radius:8px;padding:7px 9px;line-height:1.9;'>"+
        "📐 CRPU = &#8377;"+cc+" L ÷ "+crpuDen+" L units = <b style='color:#9fa8da;'>&#8377;"+crpu.toFixed(2)+"/unit</b>"+
        (ct>0&&crpu<ct?"<br>🎯 Target &#8377;"+ct.toFixed(2)+" × "+crpuDen+" L units = &#8377;"+(ct*crpuDen).toFixed(2)+" L → <b style='color:var(--gold2);'>&#8377;"+needColl.toFixed(2)+" Lakh और लाओ</b>":"")+
      "</div>"+
      "<div style='display:flex;justify-content:space-between;font-size:9px;color:var(--muted);margin-top:7px;border-top:1px dashed rgba(121,134,203,.25);padding-top:5px;'>"+
        "<span>Cum. Collection: <b style='color:var(--text);'>&#8377;"+cc+" L</b></span>"+
        "<span>Cum. Input: <b style='color:var(--text);'>"+ci+" L Units</b></span>"+
      "</div>")+
    "</div>";
  }
  var effHtml="";
  var bu=Number(HSC.bldUnits)||0,dem=Number(HSC.curDem)||0;
  if(bu>0&&ci>0&&cc>0&&dem>0&&HSC.showEff!=="0"){
    var be=bu/ci*100, ce=cc/dem*100, atc=100-(be*ce)/100;
    var beT=Number(HSC.beTgt)||0, ceT=Number(HSC.ceTgt)||0;
    var atcT=Number(HSC.atcTgt)||0;
    if(!atcT&&beT>0&&ceT>0) atcT=100-(beT*ceT)/100;
    var atcClr=(atcT>0&&atc<=atcT)?"var(--green)":"var(--red)";
    function cell(lbl,val,tgtv,clr){
      return "<div style='text-align:center;background:rgba(255,255,255,.04);border-radius:8px;padding:7px 3px;'>"+
        "<div style='font-size:9px;color:var(--muted);'>"+lbl+"</div>"+
        "<div style='font-family:\"Baloo 2\",cursive;font-size:17px;font-weight:800;color:"+clr+";'>"+val.toFixed(2)+"%</div>"+
        (tgtv>0?"<div style='font-size:9px;color:var(--muted);'>Target: <b style='color:var(--text);'>"+tgtv.toFixed(2)+"%</b></div>":"")+
      "</div>";
    }
    var needHtml="<div style='font-size:10px;color:var(--muted);margin-top:7px;background:rgba(255,209,102,.06);border:1px solid rgba(255,209,102,.18);border-radius:8px;padding:7px 9px;line-height:1.9;'>"+
      "📐 AT&amp;C Loss = 100 − ("+be.toFixed(2)+" × "+ce.toFixed(2)+" ÷ 100) = <b style='color:#4db6ac;'>"+atc.toFixed(2)+"%</b>";
    if(atcT>0&&atc>atcT){
      var prod=(100-atcT)*100;
      var beReq=ce>0?prod/ce:0, ceReq=be>0?prod/be:0;
      var exBU=beReq>be?((beReq-be)/100*ci):0;
      var exCol=ceReq>ce?((ceReq-ce)/100*dem):0;
      needHtml+="<br>🎯 Target "+atcT.toFixed(2)+"% के लिए → <b style='color:var(--gold2);'>"+exBU.toFixed(2)+" L Units और बिलिंग</b> या <b style='color:var(--gold2);'>&#8377;"+exCol.toFixed(2)+" Lakh और वसूली</b>";
    } else if(atcT>0){
      needHtml+="<br>✅ <b style='color:var(--green);'>Target "+atcT.toFixed(2)+"% प्राप्त!</b>";
    }
    needHtml+="</div>";
    effHtml="<div style='background:rgba(77,182,172,.06);border:1px solid rgba(77,182,172,.25);border-radius:10px;padding:10px;margin-top:8px;'>"+
      "<div onclick=\"toggleBoard('eff')\" style='display:flex;justify-content:space-between;align-items:center;cursor:pointer;"+(BRD_COL.eff?"":"margin-bottom:7px;")+"'>"+
        "<div style='font-size:11px;font-weight:700;color:#4db6ac;'>📉 दक्षता बोर्ड (BE / CE / AT&amp;C)</div>"+
        "<div style='font-size:9px;color:var(--muted);'>FY cumulative <b style='color:#4db6ac;font-size:13px;'>"+(BRD_COL.eff?"▸":"▾")+"</b></div>"+
      "</div>"+(BRD_COL.eff?"":
      "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;'>"+
        cell("Billing Eff.",be,beT,"#4db6ac")+
        cell("Collection Eff.",ce,ceT,"#64b5f6")+
        cell("AT&amp;C Loss",atc,atcT,atcClr)+
      "</div>"+
      needHtml+
      "<div style='margin-top:8px;border-top:1px dashed rgba(77,182,172,.25);padding-top:7px;'>"+
        "<div style='font-size:9.5px;color:var(--muted);margin-bottom:4px;'>🧮 खुद भरकर देखें — BE/CE बदलें, AT&amp;C तुरंत:</div>"+
        "<div style='display:flex;gap:6px;align-items:center;justify-content:center;'>"+
          "<input id='sim-be' inputmode='decimal' value='"+be.toFixed(2)+"' oninput='simAtc()' style='width:64px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px;color:var(--text);font-size:13px;font-weight:700;text-align:center;'>"+
          "<span style='font-size:10px;color:var(--muted);'>BE% ×</span>"+
          "<input id='sim-ce' inputmode='decimal' value='"+ce.toFixed(2)+"' oninput='simAtc()' style='width:64px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px;color:var(--text);font-size:13px;font-weight:700;text-align:center;'>"+
          "<span style='font-size:10px;color:var(--muted);'>CE% →</span>"+
          "<b id='sim-atc' style='font-family:\"Baloo 2\",cursive;font-size:16px;color:var(--gold2);'>"+atc.toFixed(2)+"%</b>"+
        "</div>"+
      "</div>")+
    "</div>";
  }
  el.innerHTML=
  "<div style='background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;'>"+
    "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;'>"+
      "<div><div style='font-family:\"Baloo 2\",cursive;font-weight:800;font-size:14px;color:var(--gold2);'>ADEGAON DC</div>"+
      "<div style='font-size:10px;color:var(--muted);'>Collection Status Summary</div></div>"+
      "<div style='text-align:right;font-size:10px;color:var(--muted);'>As on<br><b style='color:var(--text);'>"+escHtml(HSC.asOn||"")+"</b></div>"+
    "</div>"+
    "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;'>"+
      "<div style='background:rgba(33,150,243,.08);border:1px solid rgba(33,150,243,.25);border-radius:10px;padding:9px;'>"+
        "<div style='font-size:9px;color:#64b5f6;font-weight:700;margin-bottom:5px;'>इस वर्ष (अब तक)</div>"+
        "<div style='font-size:10px;color:var(--muted);'>Paid Consumers</div>"+
        "<div style='font-family:\"Baloo 2\",cursive;font-size:19px;font-weight:800;color:#64b5f6;'>"+fmtL(cp)+"</div>"+
        "<div style='font-size:10px;color:var(--muted);margin-top:4px;'>Collection</div>"+
        "<div style='font-family:\"Baloo 2\",cursive;font-size:17px;font-weight:800;color:"+g+";'>&#8377;"+ca+" Lakh</div>"+
      "</div>"+
      "<div style='background:rgba(0,200,150,.06);border:1px solid rgba(0,200,150,.2);border-radius:10px;padding:9px;'>"+
        "<div style='font-size:9px;color:var(--green);font-weight:700;margin-bottom:5px;'>गत वर्ष इसी दिनांक तक</div>"+
        "<div style='font-size:10px;color:var(--muted);'>Paid Consumers</div>"+
        "<div style='font-family:\"Baloo 2\",cursive;font-size:19px;font-weight:800;color:var(--green);'>"+fmtL(lp)+"</div>"+
        "<div style='font-size:10px;color:var(--muted);margin-top:4px;'>Collection</div>"+
        "<div style='font-family:\"Baloo 2\",cursive;font-size:17px;font-weight:800;color:"+g+";'>&#8377;"+la+" Lakh</div>"+
      "</div>"+
    "</div>"+
    "<div style='background:rgba(255,140,66,.07);border:1px solid rgba(255,140,66,.2);border-radius:10px;padding:8px 10px;display:flex;justify-content:space-between;gap:8px;'>"+
      "<div style='font-size:10px;color:var(--muted);'>उपभोक्ता अंतर<br><b style='font-size:14px;color:"+(dp>=0?g:r)+";'>"+(dp>=0?"+":"")+fmtL(dp)+" ("+(dp>=0?"+":"")+dpPct+"%)</b></div>"+
      "<div style='font-size:10px;color:var(--muted);text-align:right;'>राशि अंतर<br><b style='font-size:14px;color:"+(da>=0?g:r)+";'>"+(da>=0?"+&#8377;":"-&#8377;")+Math.abs(da).toFixed(2)+" L ("+(da>=0?"+":"")+daPct+"%)</b></div>"+
    "</div>"+
    proHtml+grHtml+cntHtml+crpuHtml+effHtml+
    (HSC.updatedBy?"<div style='font-size:9px;color:#2a4060;margin-top:6px;text-align:right;'>&#128248; "+escHtml(HSC.updatedBy)+" &bull; "+escHtml(HSC.updatedAt||"")+"</div>":"")+
  "</div>";
}
function simAtc(){
  var b=parseFloat(document.getElementById("sim-be").value),c=parseFloat(document.getElementById("sim-ce").value);
  var o=document.getElementById("sim-atc");
  if(isNaN(b)||isNaN(c)){o.textContent="—";return;}
  o.textContent=(100-(b*c)/100).toFixed(2)+"%";
}
var CASH_IVRS=null;
function openCashModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE upload कर सकते हैं","err");return;}
  CASH_IVRS=null;
  document.getElementById("cash-file").value="";
  document.getElementById("cash-ico").textContent="💵";
  document.getElementById("cash-status").textContent="Excel (.xlsx/.xls) या CSV";
  document.getElementById("cash-result").innerHTML="";
  document.getElementById("cash-apply").style.display="none";
  document.getElementById("cash-overlay").classList.add("open");
}
function closeCashModal(){document.getElementById("cash-overlay").classList.remove("open");}
function ensureXLSX(cb){
  if(window.XLSX){cb(true);return;}
  var sc=document.createElement("script");
  sc.src="vendor/xlsx.full.min.js";
  sc.onload=function(){cb(true);};
  sc.onerror=function(){cb(false);};
  document.head.appendChild(sc);
}
function cashFile(f){
  if(!f)return;
  var st=document.getElementById("cash-status");
  var name=(f.name||"").toLowerCase();
  if(name.slice(-4)===".csv"||name.slice(-4)===".txt"){
    var rd=new FileReader();
    rd.onload=function(e){
      var cells=String(e.target.result||"").split(/\r?\n/).map(function(l){return l.split(/[,;\t]/)[0];});
      cashCollect(cells);
    };
    rd.onerror=function(){st.textContent="फाइल पढ़ नहीं पाया — दोबारा try करें";};
    rd.readAsText(f);
    return;
  }
  st.textContent="⏳ Excel पढ़ा जा रहा है...";
  ensureXLSX(function(ok){
    if(!ok){document.getElementById("cash-ico").textContent="⚠";st.textContent="Excel के लिए इन्टरनेट चाहिए — या CSV फाइल चुनें";return;}
    var rd=new FileReader();
    rd.onload=function(e){
      try{
        var wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"});
        var ws=wb.Sheets[wb.SheetNames[0]];
        var rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:""});
        cashCollect(rows.map(function(r){return r&&r.length?r[0]:"";}));
      }catch(err){document.getElementById("cash-ico").textContent="⚠";st.textContent="फाइल पढ़ नहीं पाया — single column Excel चुनें";}
    };
    rd.onerror=function(){st.textContent="फाइल पढ़ नहीं पाया — दोबारा try करें";};
    rd.readAsArrayBuffer(f);
  });
}
function cashCollect(cells){
  var seen={},list=[];
  cells.forEach(function(v){
    var d=String(v==null?"":v).replace(/\D/g,"");
    if(d.length>=4&&!seen[d]){seen[d]=1;list.push(d);}
  });
  CASH_IVRS=list;
  var st=document.getElementById("cash-status");
  if(!list.length){
    document.getElementById("cash-ico").textContent="⚠";
    st.textContent="कोई IVRS नंबर नहीं मिला — पहले column में नंबर होने चाहिए";
    document.getElementById("cash-apply").style.display="none";
    return;
  }
  document.getElementById("cash-ico").textContent="✅";
  st.textContent=list.length+" IVRS मिले";
  document.getElementById("cash-result").innerHTML="फाइल से <b style='color:var(--text);'>"+list.length+"</b> IVRS नंबर मिले (जैसे: "+escHtml(list.slice(0,3).join(", "))+(list.length>3?" ...":"")+")। नीचे बटन दबाते ही सभी tabs में वसूल mark होंगे।";
  document.getElementById("cash-apply").style.display="";
}
// apply से पहले सभी लिस्ट server से ताज़ा लाओ — cache अधूरा/पुराना हो तो भी कोई IVRS न छूटे
var _CASH_REFRESH_TIMEOUT_MS=8000; // टेस्ट में छोटा करके तेज़ जांच की जा सकती है
function _cashRefreshAll(hqs,cb){
  if(!navigator.onLine){cb();return;}
  var jobs=[];
  hqs.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=(i>=4)?getCatName(hq,i):CATS_DEFAULT[i];
      if(!isPending(hq,cat)) jobs.push({hq:hq,cat:cat}); // pending offline बदलाव हों तो overwrite मत करो
    }
  });
  if(!jobs.length){cb();return;}
  var done=0;
  function fin(){done++;if(done>=jobs.length)cb();}
  // कमज़ोर नेटवर्क पर एक भी HQ/श्रेणी अटक जाए तो पूरी स्क्रीन हमेशा के लिए "लोड हो रहा है" पर न रुके —
  // 8 सेकंड में जवाब न आए तो उस एक की पुरानी cache से आगे बढ़ो; असली जवाब देर से भी आए तो cache फिर भी अपडेट होगा
  jobs.forEach(function(j){
    var finned=false;
    function safeFin(){ if(finned)return; finned=true; fin(); }
    var tm=setTimeout(safeFin,_CASH_REFRESH_TIMEOUT_MS);
    fetch(FB+"/"+fbPath(j.hq,j.cat)+".json?t="+Date.now())
      .then(function(r){return r.json();})
      .then(function(d){
        clearTimeout(tm);
        var data=normList(d);
        overlayOps(j.hq,j.cat,data);
        cSet(j.hq,j.cat,data);
        safeFin();
      })
      .catch(function(){clearTimeout(tm);safeFin();}); // fetch fail — उस tab के लिए cache से ही चलेगा
  });
}

function applyCashList(){
  if(!CASH_IVRS||!CASH_IVRS.length)return;
  var btn=document.getElementById("cash-apply");
  btn.disabled=true;btn.textContent="⏳ लिस्ट ताज़ा हो रही हैं...";
  var hqs=CU.role==="supervisor"?HQS:[CU.hq];
  _cashRefreshAll(hqs,function(){_applyCashMatched(hqs);});
}

function _applyCashMatched(hqs){
  var btn=document.getElementById("cash-apply");
  btn.textContent="⏳ mark हो रहा है...";
  var ivrs={};CASH_IVRS.forEach(function(x){ivrs[x]=1;});
  var now=new Date(),dateStr=now.toLocaleDateString("hi-IN"),dtStr=now.toLocaleString("hi-IN"),ts=Date.now();
  var matched={},newly=0,already=0,tabsChanged=0,reconciled=0;
  hqs.forEach(function(hq){
    for(var i=0;i<CATS_DEFAULT.length;i++){
      var cat=(i>=4)?getCatName(hq,i):CATS_DEFAULT[i];
      var d=cGet(hq,cat);
      if(!d||!d.length)continue;
      var prevSnap=JSON.parse(JSON.stringify(d));
      var changed=false;
      d.forEach(function(x){
        if(!x||!x.acc)return;
        var acc=String(x.acc).replace(/\D/g,"");
        if(!ivrs[acc])return;
        matched[acc]=1;
        if(x.status==="paid"){already++;return;}
        x.status="paid";x.paydate=dateStr;
        x.updatedBy=CU.name+" (कैश लिस्ट)";x.updatedAt=dtStr;x.ts=ts;
        recOp(hq,acc,"paid",dateStr,CU.name+" (कैश लिस्ट)",dtStr,ts);
        newly++;changed=true;
      });
      if(changed){fbSet(hq,cat,d,prevSnap,null);tabsChanged++;}
    }
    // एक ही उपभोक्ता कई categories में दिखता है (जैसे "कुल उपभोक्ता" + अपनी असली tariff category) —
    // ऊपर सिर्फ़ वही category paid हुई जिसमें IVRS सीधे मैच हुआ; बाकी categories में वही acc अब भी
    // "बाकी" दिखता रह जाता (यही bug था — "बाकी" filter में एक already-वसूल entry दिखना)।
    // reconcileHQ हर category में status मिलाकर बाकी सभी को भी paid कर देता है
    reconciled+=reconcileHQ(hq);
  });
  var mCount=Object.keys(matched).length,noMatch=CASH_IVRS.length-mCount;
  CASH_NOMATCH=CASH_IVRS.filter(function(x){return !matched[x];});
  document.getElementById("cash-result").innerHTML=
    "✅ <b style='color:var(--green);'>"+newly+"</b> नई वसूली दर्ज ("+tabsChanged+" tabs में)<br>"+
    (already?"ℹ "+already+" records पहले से वसूल थे<br>":"")+
    (reconciled?"🔁 "+reconciled+" record का status बाकी categories में भी मिलाया<br>":"")+
    (noMatch?"⚠ <b style='color:var(--gold2);'>"+noMatch+"</b> IVRS किसी list में नहीं मिले<br><button class='mbtn' style='margin-top:8px;background:#37474f;color:#fff;font-size:13px;padding:9px 14px;' onclick='downloadNoMatch()'>⬇ नहीं मिले IVRS की Excel डाउनलोड करें</button>":"सभी IVRS match हो गए 🎉");
  btn.style.display="none";btn.disabled=false;btn.textContent="✔ सभी को वसूल करें";
  toast("✅ कैश लिस्ट लागू — "+newly+" वसूली दर्ज","ok");
  try{renderSummaryWith(cGet(activeHQ,activeCat)||[]);renderListWith(cGet(activeHQ,activeCat)||[]);}catch(e){}
}
var CASH_NOMATCH=null;
function downloadNoMatch(){
  if(!CASH_NOMATCH||!CASH_NOMATCH.length){toast("नहीं मिले IVRS की सूची खाली है","err");return;}
  ensureXLSX(function(ok){
    if(!ok){
      var csv="IVRS No\n"+CASH_NOMATCH.join("\n");
      var bl=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
      var aEl=document.createElement("a");
      aEl.href=URL.createObjectURL(bl);
      aEl.download="NoMatch_IVRS_"+new Date().toLocaleDateString("en-IN").replace(/\//g,"-")+".csv";
      aEl.click();
      return;
    }
    var rows=[["IVRS No"]];
    CASH_NOMATCH.forEach(function(x){rows.push([x]);});
    var ws=XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"]=[{wch:18}];
    var wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"NoMatch");
    XLSX.writeFile(wb,"NoMatch_IVRS_"+new Date().toLocaleDateString("en-IN").replace(/\//g,"-")+".xlsx");
  });
}
function openHscModal(){
  if(!CU||CU.role!=="supervisor"){toast("सिर्फ JE upload कर सकते हैं","err");return;}
  ["hsc-ason","hsc-curpaid","hsc-curamt","hsc-lypaid","hsc-lyamt","hsc-pbitgt","hsc-pbimonth","hsc-cashdem","hsc-lyfull","hsc-growth","hsc-growmonth","hsc-lyfullpaid","hsc-cntgrowth","hsc-cumcoll","hsc-cuminput","hsc-crputgt","hsc-bldunits","hsc-curdem","hsc-betgt","hsc-cetgt","hsc-atctgt"].forEach(function(id){document.getElementById(id).value="";});
  document.getElementById("hsc-showboard").checked=!(HSC&&HSC.showBoard==="0");
  document.getElementById("hsc-showcrpu").checked=!(HSC&&HSC.showCrpu==="0");
  document.getElementById("hsc-showeff").checked=!(HSC&&HSC.showEff==="0");
  if(HSC){
    document.getElementById("hsc-ason").value=HSC.asOn||"";
    document.getElementById("hsc-curpaid").value=HSC.curPaid||"";
    document.getElementById("hsc-curamt").value=HSC.curAmt||"";
    document.getElementById("hsc-lypaid").value=HSC.lyPaid||"";
    document.getElementById("hsc-lyamt").value=HSC.lyAmt||"";
    document.getElementById("hsc-pbitgt").value=HSC.pbiTgt||"";
    document.getElementById("hsc-pbimonth").value=HSC.pbiMonth||"";
    document.getElementById("hsc-cashdem").value=HSC.cashDem||"";
    document.getElementById("hsc-lyfull").value=HSC.lyFull||"";
    document.getElementById("hsc-growmonth").value=HSC.growMonth||"";
    document.getElementById("hsc-lyfullpaid").value=HSC.lyFullPaid||"";
    document.getElementById("hsc-cntgrowth").value=HSC.cntGrowth||"";
    document.getElementById("hsc-growth").value=HSC.growth||"";
    document.getElementById("hsc-cumcoll").value=HSC.cumColl||"";
    document.getElementById("hsc-cuminput").value=HSC.cumInput||"";
    document.getElementById("hsc-crputgt").value=HSC.crpuTgt||"";
    document.getElementById("hsc-bldunits").value=HSC.bldUnits||"";
    document.getElementById("hsc-curdem").value=HSC.curDem||"";
    document.getElementById("hsc-betgt").value=HSC.beTgt||"";
    document.getElementById("hsc-cetgt").value=HSC.ceTgt||"";
    document.getElementById("hsc-atctgt").value=HSC.atcTgt||"";
  }
  document.getElementById("hsc-overlay").classList.add("open");
}
function closeHscModal(){document.getElementById("hsc-overlay").classList.remove("open");}
function saveHsc(){
  var d={
    asOn:document.getElementById("hsc-ason").value.trim(),
    curPaid:document.getElementById("hsc-curpaid").value.replace(/,/g,"").trim(),
    curAmt:document.getElementById("hsc-curamt").value.replace(/,/g,"").trim(),
    lyPaid:document.getElementById("hsc-lypaid").value.replace(/,/g,"").trim(),
    lyAmt:document.getElementById("hsc-lyamt").value.replace(/,/g,"").trim(),
    pbiTgt:document.getElementById("hsc-pbitgt").value.replace(/,/g,"").trim(),
    pbiMonth:document.getElementById("hsc-pbimonth").value.trim(),
    showBoard:document.getElementById("hsc-showboard").checked?"1":"0",
    showCrpu:document.getElementById("hsc-showcrpu").checked?"1":"0",
    showEff:document.getElementById("hsc-showeff").checked?"1":"0",
    cashDem:document.getElementById("hsc-cashdem").value.replace(/,/g,"").trim(),
    lyFull:document.getElementById("hsc-lyfull").value.replace(/,/g,"").trim(),
    growMonth:document.getElementById("hsc-growmonth").value.trim(),
    lyFullPaid:document.getElementById("hsc-lyfullpaid").value.replace(/,/g,"").trim(),
    cntGrowth:document.getElementById("hsc-cntgrowth").value.replace(/,/g,"").trim()||"25",
    growth:document.getElementById("hsc-growth").value.replace(/,/g,"").trim()||"25",
    cumColl:document.getElementById("hsc-cumcoll").value.replace(/,/g,"").trim(),
    cumInput:document.getElementById("hsc-cuminput").value.replace(/,/g,"").trim(),
    crpuTgt:document.getElementById("hsc-crputgt").value.replace(/,/g,"").trim(),
    bldUnits:document.getElementById("hsc-bldunits").value.replace(/,/g,"").trim(),
    curDem:document.getElementById("hsc-curdem").value.replace(/,/g,"").trim(),
    beTgt:document.getElementById("hsc-betgt").value.replace(/,/g,"").trim(),
    ceTgt:document.getElementById("hsc-cetgt").value.replace(/,/g,"").trim(),
    atcTgt:document.getElementById("hsc-atctgt").value.replace(/,/g,"").trim(),
    updatedBy:CU?CU.name:"",updatedAt:new Date().toLocaleString("hi-IN"),
    ts:Date.now() // नया-पुराना तय करने के लिए — बड़ा ts हमेशा जीतता है
  };
  if(!d.curPaid||!d.curAmt){toast("इस वर्ष के आँकड़े जरूरी हैं","err");return;}
  HSC=d;
  try{localStorage.setItem("dc_homesc3",JSON.stringify(d));}catch(e){}
  renderHomeSc();
  closeHscModal();
  fetch(FB+"/HOME_SCORECARD.json",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)})
    .then(function(r){
      if(r.ok){_setHscPending(false);toast("✅ डिस्प्ले बोर्ड प्रकाशित — सबके होम पेज पर दिखेगा","ok");return;}
      _setHscPending(true);
      logErr("hsc-publish",new Error("HTTP "+r.status));
      if(r.status===401||r.status===403)
        toast("🔐 प्रकाशित नहीं हुआ — JE नेट चालू रखकर logout करके दोबारा login करें, फिर 'प्रकाशित करें' दबाएँ","err");
      else
        toast("⚠ save नहीं हुआ (HTTP "+r.status+") — दोबारा try करें","err");
    })
    .catch(function(){_setHscPending(true);toast("📴 ऑफलाइन — बोर्ड device पर save है, नेट आने पर app खोलते ही अपने आप प्रकाशित होगा","inf");});
}

