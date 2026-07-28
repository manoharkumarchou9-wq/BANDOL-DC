// ── स्वचालित बैकअप (GitHub Actions से रोज़ चलता है) ──────────────────────────
// सभी HQ × श्रेणी + डिस्प्ले बोर्ड को एक Excel फ़ाइल में इकट्ठा करता है — बिल्कुल वैसे ही जैसे
// ऐप का मैन्युअल "पूरा बैकअप" बटन (js/reports.js: downloadFullBackup) बनाता है।
// Firebase Admin SDK इस्तेमाल होता है — यह Security Rules/App Check दोनों को bypass करता है
// (एक privileged, सर्वर-साइड-सिर्फ़ पहुंच), इसलिए client ऐप के access-control से यह अलग/independent है।
// फ़ाइल कहीं भी Firebase/Google Cloud storage में सेव नहीं होती — सिर्फ़ इसी run की GitHub Actions
// artifact के तौर पर बनती है (देखें .github/workflows/backup.yml की retention-days सेटिंग)।
const admin = require("firebase-admin");
const XLSX = require("xlsx");
const fs = require("fs");

const HQS = ["आदेगांव", "पिंडरई", "जोबा", "पाटन", "बीबी", "मढ़ी"];
const CATS_DEFAULT = ["कुल उपभोक्ता", "घरेलू", "व्यवसाय", "कृषि", "गवर्नमेंट", "इंडस्ट्रियल", "सूची-2", "सूची-3"];

function hqKey(hq) { return hq.replace(/[\s.#$\[\]]/g, "_"); }
function pathKey(s) { return String(s).replace(/\s/g, "_").replace(/[.#$\[\]]/g, "_"); }
function bkSheetName(s) { return String(s).replace(/[\[\]:*?\/\\]/g, "_").slice(0, 31); }
function normList(d) {
  if (!d) return [];
  var arr = Array.isArray(d) ? d.filter(Boolean) : Object.keys(d).map(function (k) { return d[k]; }).filter(Boolean);
  var hasO = arr.some(function (x) { return x && x.o != null; });
  if (hasO) arr.sort(function (a, b) { return (Number(a && a.o) || 0) - (Number(b && b.o) || 0); });
  return arr;
}

async function main() {
  var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://adegaon-dc-top-50-default-rtdb.firebaseio.com",
  });
  var db = admin.database();

  var catNamesSnap = await db.ref("CAT_NAMES").once("value");
  var catNames = catNamesSnap.val() || {};
  function getCatName(hq, i) {
    var hk = hqKey(hq);
    return (catNames[hk] && catNames[hk][i] != null) ? catNames[hk][i] : CATS_DEFAULT[i];
  }

  var wb = XLSX.utils.book_new();
  var head = ["क्र.", "नाम", "पिता/पति", "Consumer No", "बकाया", "Tariff", "Load", "Unit", "Mobile", "पता", "स्थिति", "भुगतान तिथि", "पिछला भुगतान", "पिछला तिथि", "रिमार्क (सभी)", "अपडेट by", "अपडेट समय"];
  var sum = [["HQ", "श्रेणी", "कुल", "वसूल", "बाकी", "बाकी राशि"]];
  var totalRecs = 0;

  for (var h = 0; h < HQS.length; h++) {
    var hq = HQS[h];
    for (var i = 0; i < CATS_DEFAULT.length; i++) {
      var cat = i >= 4 ? getCatName(hq, i) : CATS_DEFAULT[i];
      var snap = await db.ref(pathKey(hq) + "/" + pathKey(cat)).once("value");
      var d = normList(snap.val());
      if (!d.length) continue;
      var paid = 0, pendAmt = 0;
      var rows = [head];
      d.forEach(function (x, n) {
        if (!x) return;
        if (x.status === "paid") paid++; else pendAmt += Number(x.amount) || 0;
        var allRmk = (x.remarksArr || []).map(function (r) { return r.text + " (" + r.by + ")"; }).join(" | ");
        rows.push([n + 1, x.name || "", x.father || "", x.acc || "", Number(x.amount) || 0, x.tariff || "", x.load || "", x.unit || "", x.phone || "", x.addr || "", x.status === "paid" ? "वसूल" : "बाकी", x.paydate || "", x.lastPaidAmt || "", x.lastPayDate || "", allRmk, x.updatedBy || "", x.updatedAt || ""]);
      });
      totalRecs += d.length;
      sum.push([hq, cat, d.length, paid, d.length - paid, pendAmt]);
      var ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 4 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 13 }, { wch: 18 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 35 }, { wch: 14 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, bkSheetName(hq + "_" + cat));
    }
  }

  if (totalRecs === 0) {
    console.log("कोई data नहीं मिला — backup skip किया");
    process.exit(0);
  }

  var now = new Date();
  sum.push([]);
  sum.push(["बैकअप समय (UTC)", now.toISOString()]);
  sum.push(["कुल records", totalRecs]);
  var wsSum = XLSX.utils.aoa_to_sheet(sum);
  wsSum["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "सारांश");
  wb.SheetNames.unshift(wb.SheetNames.pop()); // सारांश को पहली sheet बनाओ

  var hscSnap = await db.ref("HOME_SCORECARD").once("value");
  var hsc = hscSnap.val();
  if (hsc) {
    var hb = [["Field", "Value"]];
    Object.keys(hsc).forEach(function (k) { hb.push([k, String(hsc[k])]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hb), "डिस्प्ले बोर्ड");
  }

  fs.mkdirSync("backup-output", { recursive: true });
  var fn = "adegaon-backup-" + now.toISOString().slice(0, 10) + ".xlsx";
  XLSX.writeFile(wb, "backup-output/" + fn);
  console.log("बैकअप बना: " + fn + " (" + totalRecs + " records)");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
