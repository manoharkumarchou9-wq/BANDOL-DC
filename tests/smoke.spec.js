// @ts-check
// वसूली ट्रैकर — smoke tests
// हर बाहरी request (CDN/Firebase/Google) block की जाती है ताकि:
//  1. tests कभी असली production database को न छुएं
//  2. app का offline-first रास्ता भी हर PR पर अपने आप जांचा जाए
const { test, expect } = require('@playwright/test');

/** @param {import('@playwright/test').Page} page */
async function blockExternal(page) {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

/** @param {import('@playwright/test').Page} page */
async function openApp(page) {
  await blockExternal(page);
  await page.goto('/');
  // startApp 2 sec के fallback timer पर चलता है
  await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
}

/** @param {import('@playwright/test').Page} page */
async function loginLineman(page, name = 'टेस्ट लाइनमैन') {
  await page.click('#rc-lin');
  await page.fill('#uname-inp', name);
  await page.selectOption('#hq-sel', { index: 1 });
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
}

/** @param {import('@playwright/test').Page} page */
async function loginJE(page, pw = 'Test#123') {
  await page.evaluate((p) => _saveJEHash(p), pw); // offline-hash रास्ता — नेट बंद है
  await page.click('#rc-sup');
  await page.fill('#uname-inp', 'टेस्ट जेई');
  await page.fill('#sup-pw', pw);
  await page.click('.login-btn');
  await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
}

test.describe('बूट और login', () => {
  test('app बिना नेट के भी खुलती है और version दिखाती है', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await expect(page.locator('#ver-badge')).toContainText('Version');
    expect(errors).toEqual([]);
  });

  test('lineman login चलता है — tabs और summary बनते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    expect(await page.locator('.cat-tab').count()).toBe(8);
    // summary offline में token-gate (4s) के बाद render होती है — इंतज़ार करें
    await page.waitForFunction(() => document.querySelectorAll('.sbox').length === 4, null, { timeout: 15000 });
  });

  test('JE गलत पासवर्ड पर रुकता है, सही पर अंदर जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => _saveJEHash('SahiPass#1'));
    await page.click('#rc-sup');
    await page.fill('#uname-inp', 'जेई');
    await page.fill('#sup-pw', 'galat-pass');
    await page.click('.login-btn');
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    await page.fill('#sup-pw', 'SahiPass#1');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'));
  });
});

test.describe('रोल-आधारित UI', () => {
  test('JE को dropdown में चारों tools दिखते हैं, lineman को नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const jeVisible = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item']
        .every((id) => document.getElementById(id).style.display !== 'none'));
    expect(jeVisible).toBe(true);
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHidden = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item', 'mig-menu-item']
        .every((id) => document.getElementById(id).style.display === 'none'));
    expect(linHidden).toBe(true);
  });

  test('JE के सभी modals खुलते-बंद होते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const ok = await page.evaluate(() => {
      const results = [];
      openUpModal(); results.push(document.getElementById('up-overlay').classList.contains('open')); closeUpModal();
      openScorecard(); results.push(document.getElementById('sc-overlay').classList.contains('open')); closeScModal();
      openLogModal(); results.push(document.getElementById('log-overlay').classList.contains('open')); closeLogModal();
      openHscModal(); results.push(document.getElementById('hsc-overlay').classList.contains('open')); closeHscModal();
      openCashModal(); results.push(document.getElementById('cash-overlay').classList.contains('open')); closeCashModal();
      openWaScorecard(); results.push(document.getElementById('wasc-overlay').classList.contains('open')); closeWaScorecard();
      openMigModal(); results.push(document.getElementById('mig-overlay').classList.contains('open')); closeMigModal();
      return results;
    });
    expect(ok).toEqual([true, true, true, true, true, true, true]);
  });

  test('स्कोरकार्ड डिस्प्ले — सभी HQ की सही गिनती और वसूल% बनता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', status: 'paid', amount: 100 },
        { acc: '2', status: 'pending', amount: 500 },
      ]);
    });
    await page.evaluate(() => openWaScorecard());
    await page.waitForFunction(() => document.querySelectorAll('#wasc-content tbody tr').length === 6, null, { timeout: 20000 });
    const r = await page.evaluate(() => {
      const row = document.querySelectorAll('#wasc-content tbody tr')[0];
      return {
        hq: row.querySelector('.wasc-hq').textContent,
        paidBold: row.querySelector('.wasc-paid-num').textContent,
        text: row.textContent,
      };
    });
    expect(r.hq).toBe('आदेगांव');
    expect(r.paidBold).toBe('1');
    expect(r.text).toContain('50.0%');
  });

  test('स्कोरकार्ड — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने (ग्राम-वार वसूली से मेल के लिए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const row = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      // acc '99' किसी और श्रेणी में paid है पर "कुल उपभोक्ता" (मास्टर) में मौजूद ही नहीं — असली उपभोक्ता नहीं
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200 },
      ]);
      return _waScRow('आदेगांव');
    });
    expect(row.tot).toBe(1);
    expect(row.paid).toBe(0); // acc '99' नहीं गिना जाना चाहिए — मास्टर सूची में नहीं है
  });
});

test.describe('डेटा और वसूली', () => {
  test('cache की लिस्ट render होती है और वसूल mark काम करता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
      ]);
    });
    await loginLineman(page); // HQ index 1 = आदेगांव (index 0 placeholder)
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    await page.evaluate(() => markPaid(0));
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता')[0].status);
    expect(st).toBe('paid');
  });

  test('कैश लिस्ट: नया-पुराना timestamp नियम (बोर्ड टकराव)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((res) => {
      let serverBoard = { curPaid: '999', curAmt: '9', ts: 200 };
      let putCount = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putCount++; serverBoard = JSON.parse(opts.body); return Promise.resolve({ ok: true, json: () => Promise.resolve(serverBoard) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(serverBoard) });
        }
        return orig(url, opts);
      };
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      // पुराना local (ts=100) → server (ts=200) अपनाए, PUT न करे
      HSC = { curPaid: '0', curAmt: '0', ts: 100 };
      _setHscPending(true);
      _hscRetryPublish();
      setTimeout(() => {
        const case1 = HSC.curPaid === '999' && putCount === 0 && !_hscPending();
        // नया local (ts=300) → PUT हो
        HSC = { curPaid: '777', curAmt: '7', ts: 300 };
        _setHscPending(true);
        _hscRetryPublish();
        setTimeout(() => res({ case1, case2: putCount === 1 && serverBoard.curPaid === '777' }), 400);
      }, 400);
    }));
    expect(r.case1).toBe(true);
    expect(r.case2).toBe(true);
  });
});

test.describe('ग्राम-वार वसूली', () => {
  test('JE को सभी HQ tabs दिखते हैं, lineman को सिर्फ अपना HQ', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(500);
    const jeTabs = await page.locator('#vg-hq-tabs .hq-tab').count();
    expect(jeTabs).toBe(6); // HQS.length जितने tabs
    await page.evaluate(() => closeVillageModal());
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(500);
    const linTabs = await page.locator('#vg-hq-tabs .hq-tab').count();
    expect(linTabs).toBe(1);
  });

  test('_vgLoadAndRender अब सभी 8 श्रेणियां ताज़ा करता है (स्कोरकार्ड जैसा) — सिर्फ मास्टर category नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { vgActiveHQ = 'आदेगांव'; });
    const jeHqs = await page.evaluate(() => new Promise((resolve) => {
      window._cashRefreshAll = function (hqs, cb) { resolve(hqs.slice()); cb(); };
      _vgLoadAndRender();
    }));
    expect(jeHqs.length).toBe(6); // JE — सभी HQ की सभी श्रेणियां ताज़ा हों (जैसा downloadVillageExcel में पहले से है)
    expect(jeHqs).toContain('आदेगांव');

    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHqs = await page.evaluate(() => new Promise((resolve) => {
      window._cashRefreshAll = function (hqs, cb) { resolve(hqs.slice()); cb(); };
      vgActiveHQ = CU.hq;
      _vgLoadAndRender();
    }));
    expect(linHqs).toEqual([await page.evaluate(() => CU.hq)]); // lineman — सिर्फ अपना HQ
  });

  test('गांव-वार गिनती, खोज, राशि और योग — सीधे टेबल में सही बनते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'paid', amount: 100 },
        { acc: '2', addr: 'रामपुर', status: 'pending', amount: 200 },
        { acc: '3', addr: 'श्यामपुर', status: 'paid', amount: 150 },
      ]);
    });
    await page.evaluate(() => openVillageModal());
    await page.waitForFunction(() => document.querySelectorAll('#vg-list tbody tr').length === 2, null, { timeout: 15000 });
    // खोज
    await page.fill('#vg-search', 'राम');
    await page.waitForTimeout(200);
    expect(await page.locator('#vg-list tbody tr').count()).toBe(1);
    await page.fill('#vg-search', '');
    await page.evaluate(() => _vgRenderList());
    const footer = await page.locator('#vg-list tfoot').textContent();
    expect(footer).toContain('योग (2 गांव)');
    expect(footer).toContain('66.7%');
    expect(footer).toContain('₹200'); // बकाया
    expect(footer).toContain('₹250'); // वसूल राशि (100+150)
  });

  test('किसी भी श्रेणी में paid mark हो तो ग्राम-वार वसूली में भी वसूल गिना जाए (स्कोरकार्ड जैसा)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      // मास्टर "कुल उपभोक्ता" में यह उपभोक्ता अभी भी pending दिखा रहा है...
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '501', addr: 'टेस्टपुर', status: 'pending', amount: 300 },
      ]);
      // ...लेकिन "घरेलू" श्रेणी में उसे वसूल mark कर दिया गया है
      cSet('आदेगांव', 'घरेलू', [
        { acc: '501', addr: 'टेस्टपुर', status: 'paid', amount: 300 },
      ]);
    });
    const row = await page.evaluate(() => _vgComputeRows('आदेगांव')[0]);
    expect(row.tot).toBe(1);
    expect(row.paid).toBe(1);
    expect(row.bakaya).toBe(0);
    expect(row.paidAmt).toBe(300);
  });

  test('मिलते-जुलते गांव-नाम (केस भिन्नता + अलग-टोकन) रिपोर्ट में मर्ज होते हैं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', status: 'paid', amount: 100 },
        { acc: '2', addr: 'PIPARIYA JOBA', status: 'pending', amount: 200 },
        { acc: '3', addr: 'Khubi', status: 'paid', amount: 50 },
        { acc: '4', addr: 'KHUBI', status: 'pending', amount: 60 },
      ]);
    });
    await page.evaluate(() => openVillageModal());
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('#vg-hq-tabs .hq-tab')).find((t) => t.textContent === 'जोबा').click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#vg-list tbody tr').length === 2, null, { timeout: 15000 });
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#vg-list tbody tr')).map((r) => r.textContent));
    expect(rows.some((r) => r.includes('2') && (r.includes('PIPARIYA') || r.includes('Piparia')))).toBe(true);
    expect(rows.some((r) => /khubi/i.test(r) && r.includes('2'))).toBe(true);
  });

  test('बीबी HQ के नए मर्ज-समूह (DEORI/DEVRI, KHAMARIYA KACHHI ग्रुप, MOHGAON KACCHI, NAVALGAON ग्रुप) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      deori: [_vgNormKey('बीबी', 'DEORI'), _vgNormKey('बीबी', 'DEVRI')],
      khamariya: [
        _vgNormKey('बीबी', 'KHAMARIYA KACCHI'),
        _vgNormKey('बीबी', 'KHAMARIYA KACHHI'),
        _vgNormKey('बीबी', 'KHAMARIYA KACHHI TOLA'),
        _vgNormKey('बीबी', 'KHMRIYA KACHHI'),
      ],
      mohgaon: [
        _vgNormKey('बीबी', 'MOHGAON KACCHI'),
        _vgNormKey('बीबी', 'MOHGAON KACHHI'),
        _vgNormKey('बीबी', 'Mohgaon kachi'),
        _vgNormKey('बीबी', 'MOHGAON KACHHI AUR'),
      ],
      navalgaon: [
        _vgNormKey('बीबी', 'NAVAL GAON'),
        _vgNormKey('बीबी', 'NAVALGAON'),
        _vgNormKey('बीबी', 'Nawalgaon'),
      ],
    }));
    expect(new Set(r.deori).size).toBe(1);
    expect(new Set(r.khamariya).size).toBe(1);
    expect(new Set(r.mohgaon).size).toBe(1);
    expect(new Set(r.navalgaon).size).toBe(1);
  });

  test('मढ़ी HQ के मर्ज-समूह (JAMUA/JUMUA, RAHLI/REHLI, KHAMARIYA GUJAR/MADHI) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      jamua: [_vgNormKey('मढ़ी', 'JAMUA'), _vgNormKey('मढ़ी', 'JUMUA')],
      rahli: [_vgNormKey('मढ़ी', 'RAHLI'), _vgNormKey('मढ़ी', 'REHLI')],
      khamariya: [_vgNormKey('मढ़ी', 'KHAMARIYA GUJAR'), _vgNormKey('मढ़ी', 'KHAMARIYA MADHI')],
    }));
    expect(new Set(r.jamua).size).toBe(1);
    expect(new Set(r.rahli).size).toBe(1);
    expect(new Set(r.khamariya).size).toBe(1);
  });

  test('पाटन HQ के मर्ज-समूह (JUBAN/JUWAN TOLA ग्रुप, JOGANI/JOGNI TOLA) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      juban: [_vgNormKey('पाटन', 'JUBAN TOLA'), _vgNormKey('पाटन', 'JUWAN TOLA'), _vgNormKey('पाटन', 'JUWANTOLA')],
      jogani: [_vgNormKey('पाटन', 'JOGANI TOLA'), _vgNormKey('पाटन', 'JOGNI TOLA')],
    }));
    expect(new Set(r.juban).size).toBe(1);
    expect(new Set(r.jogani).size).toBe(1);
  });

  test('जोबा HQ का KOMSAGHAT/KOSAMAGHT मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      komsaghat: [_vgNormKey('जोबा', 'KOMSAGHAT'), _vgNormKey('जोबा', 'KOSAMAGHT')],
    }));
    expect(new Set(r.komsaghat).size).toBe(1);
  });

  test('पिंडरई HQ के मर्ज-समूह (KARABDOL/KARAPDOL, SINGHODI MOCHIPATHAR ग्रुप) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      karabdol: [_vgNormKey('पिंडरई', 'KARABDOL'), _vgNormKey('पिंडरई', 'KARAPDOL')],
      singhodi: [
        _vgNormKey('पिंडरई', 'SINGHODI MOCHIPATHAR'),
        _vgNormKey('पिंडरई', 'SINGODI MOCHI'),
        _vgNormKey('पिंडरई', 'SINGODI MOCHIPATHAR'),
      ],
    }));
    expect(new Set(r.karabdol).size).toBe(1);
    expect(new Set(r.singhodi).size).toBe(1);
  });

  test('पाटन HQ का KALYAN PUR/KALYANPUR मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      kalyanpur: [_vgNormKey('पाटन', 'KALYAN PUR'), _vgNormKey('पाटन', 'KALYANPUR')],
    }));
    expect(new Set(r.kalyanpur).size).toBe(1);
  });

  test('आदेगांव HQ के मर्ज-समूह (HAMEERGAGH/HAMEERGARH, CHHOTA/CHOTA BICHHUA) एक ही कुंजी में पड़ते हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      hameergarh: [_vgNormKey('आदेगांव', 'HAMEERGAGH'), _vgNormKey('आदेगांव', 'HAMEERGARH')],
      bichhua: [_vgNormKey('आदेगांव', 'CHHOTA BICHHUA'), _vgNormKey('आदेगांव', 'CHOTA BICHHUA')],
    }));
    expect(new Set(r.hameergarh).size).toBe(1);
    expect(new Set(r.bichhua).size).toBe(1);
  });

  test('पिंडरई HQ का PINDARI RAIYAT/PINDRAI RAIYAT मर्ज-समूह एक ही कुंजी में पड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      pindariRaiyat: [_vgNormKey('पिंडरई', 'PINDARI RAIYAT'), _vgNormKey('पिंडरई', 'PINDRAI RAIYAT')],
    }));
    expect(new Set(r.pindariRaiyat).size).toBe(1);
  });
});

test.describe('गांव-वार सुधरी Excel', () => {
  test('मिलते-जुलते गांव-नाम मर्ज करके सारांश + HQ-वार sheets बनती हैं', async ({ page }) => {
    test.setTimeout(90000); // background prefetch (offline-gated fetches) को settle होने का समय — धीमे CI runner पर flake रोकने के लिए
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000); // login के बाद का background prefetch शुरू होकर शांत हो जाए
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', name: 'राम', status: 'paid', amount: 100 },
        { acc: '2', addr: 'PIPARIYA JOBA', name: 'श्याम', status: 'pending', amount: 100 },
      ]);
    });
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push({ name: nm, rows: ws.rows }); },
        },
        writeFile: function (wb) { res({ order: wb.SheetNames.slice(), sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    expect(r.order[0]).toBe('सारांश');
    const summarySheet = r.sheets.find((s) => s.name === 'सारांश');
    const jobaRow = summarySheet.rows.find((row) => row[0] === 'जोबा');
    expect(jobaRow[1]).toBe('PIPARIYA'); // मर्ज होकर एक ही गांव
    expect(jobaRow[2]).toBe(2); // कुल कनेक्शन
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    expect(jobaSheet.rows.length).toBe(3); // header + 2 records
  });

  test('lineman भी डाउनलोड कर सकता है, पर सिर्फ अपने HQ का', async ({ page }) => {
    test.setTimeout(90000); // background prefetch (offline-gated fetches) को settle होने का समय — धीमे CI runner पर flake रोकने के लिए
    await openApp(page);
    await loginLineman(page); // HQ index 1 = पिंडरई
    await page.waitForTimeout(2000); // login के बाद का background prefetch शुरू होकर शांत हो जाए
    const myHQ = await page.evaluate(() => CU.hq);
    await page.evaluate(() => {
      cSet(CU.hq, 'कुल उपभोक्ता', [{ acc: '1', addr: 'ORAPANI', name: 'राधा', status: 'paid', amount: 100 }]);
      cSet('जोबा', 'कुल उपभोक्ता', [{ acc: '9', addr: 'PIPARIYA', name: 'गीता', status: 'paid', amount: 50 }]);
    });
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push(nm); },
        },
        writeFile: function (wb) { res({ sheets: wb.SheetNames.slice() }); },
      };
      downloadVillageExcel();
    }));
    expect(r.sheets).toContain(myHQ);
    expect(r.sheets).not.toContain('जोबा');
  });
});

test.describe('data format (चरण 1 — दोनों ढांचे)', () => {
  test('normList पुराना array और नया per-record object दोनों पढ़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const rec1 = { acc: '111', name: 'राम', status: 'pending', amount: 100 };
      const rec2 = { acc: '222', name: 'श्याम', status: 'paid', amount: 200 };
      // 1. पुराना ढांचा: array (null holes सहित)
      const a = normList([rec1, null, rec2]);
      // 2. नया ढांचा: object keyed by IVRS
      const b = normList({ '111': rec1, '222': rec2 });
      // 3. नया ढांचा + 'o' क्रम — upload का order बहाल हो
      const c = normList({ '111': { acc: '111', o: 2 }, '222': { acc: '222', o: 1 } });
      // 4. खाली/null
      const d = normList(null);
      return {
        arrayOk: a.length === 2 && a[0].acc === '111' && a[1].acc === '222',
        objectOk: b.length === 2 && b[0].acc === '111',
        remarksMigrated: Array.isArray(b[0].remarksArr),
        orderOk: c[0].acc === '222' && c[1].acc === '111',
        nullOk: Array.isArray(d) && d.length === 0,
      };
    });
    expect(r).toEqual({ arrayOk: true, objectOk: true, remarksMigrated: true, orderOk: true, nullOk: true });
  });
});

test.describe('SSE bandwidth बचत', () => {
  test('_sseFullPutData — path:"/" पर data लौटाए, वरना दोबारा fetch का संकेत दे', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      full: _sseFullPutData(JSON.stringify({ path: '/', data: [{ acc: '1' }] })),
      nullData: _sseFullPutData(JSON.stringify({ path: '/', data: null })),
      subPath: _sseFullPutData(JSON.stringify({ path: '/5', data: { acc: '1' } })),
      badJson: _sseFullPutData('not-json{'),
    }));
    expect(r.full).toEqual({ ok: true, data: [{ acc: '1' }] });
    expect(r.nullData).toEqual({ ok: true, data: null });
    expect(r.subPath).toEqual({ ok: false });
    expect(r.badJson).toEqual({ ok: false });
  });
});

test.describe('चरण 3 माइग्रेशन — Dry-run जांच', () => {
  test('_migAnalyzeList — missing/duplicate/अवैध acc सही पकड़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => ({
      clean: _migAnalyzeList([{ acc: '1' }, { acc: '2' }, { acc: '3' }]),
      missing: _migAnalyzeList([{ acc: '1' }, { acc: '' }, { name: 'no-acc' }]),
      dup: _migAnalyzeList([{ acc: '5' }, { acc: '5' }, { acc: '6' }]),
      illegal: _migAnalyzeList([{ acc: '7' }, { acc: 'a.b' }, { acc: 'c#d' }]),
      alreadyObjFmt: _migAnalyzeList({ '1': { acc: '1' }, '2': { acc: '2' } }),
      empty: _migAnalyzeList(null),
    }));
    expect(r.clean).toEqual(expect.objectContaining({ tot: 3, missingAcc: 0, dupAcc: 0, illegalAcc: 0 }));
    expect(r.missing).toEqual(expect.objectContaining({ tot: 3, missingAcc: 2 }));
    expect(r.dup).toEqual(expect.objectContaining({ tot: 3, dupAcc: 1 }));
    expect(r.dup.dupSamples).toContain('5');
    expect(r.illegal).toEqual(expect.objectContaining({ tot: 3, illegalAcc: 2 }));
    expect(r.alreadyObjFmt).toEqual(expect.objectContaining({ tot: 2, alreadyObj: true }));
    expect(r.empty).toEqual(expect.objectContaining({ tot: 0 }));
  });

  test('सिर्फ JE "चरण 3 जांच" खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openMigModal());
    expect(await page.evaluate(() => document.getElementById('mig-overlay').classList.contains('open'))).toBe(false);
  });

  test('_migConvertToObject — acc को key बनाकर o (क्रम) जोड़ता है, बिना acc वाला record छोड़ देता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() =>
      _migConvertToObject([{ acc: '10', name: 'क' }, { name: 'बिना-acc' }, { acc: '20', name: 'ख' }])
    );
    expect(Object.keys(r).sort()).toEqual(['10', '20']);
    expect(r['10']).toEqual(expect.objectContaining({ name: 'क', o: 0 }));
    expect(r['20']).toEqual(expect.objectContaining({ name: 'ख', o: 2 }));
  });
});

test.describe('डिवाइस Version ट्रैकिंग', () => {
  test('login होते ही pingDeviceVersion सही payload के साथ PUT करता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/DEVICE_VERSIONS/') > -1) {
          resolve({ url: String(url), body: JSON.parse(opts.body), method: opts.method, ver: APP_VER });
          window.fetch = real;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      pingDeviceVersion();
    }));
    expect(call.method).toBe('PUT');
    expect(call.body).toEqual(expect.objectContaining({ v: call.ver, role: 'supervisor' }));
  });

  test('logout पर deviceTimer साफ़ हो जाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.waitForFunction(() => deviceTimer !== null);
    await page.evaluate(() => doLogout(false));
    expect(await page.evaluate(() => deviceTimer)).toBeNull();
  });

  test('_dvRender — पुराने version वाले devices को अलग/ऊपर दिखाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf('/DEVICE_VERSIONS.json') > -1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            d1: { v: APP_VER, hq: 'आदेगांव', role: 'supervisor', name: 'JE', t: Date.now() },
            d2: { v: '9.0', hq: 'पिंडरई', role: 'lineman', name: 'पुराना लाइनमैन', t: Date.now() - 1000 },
          }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
      };
      _dvRender();
    });
    await page.waitForFunction(() => document.getElementById('mig-devices').textContent.indexOf('पुराना लाइनमैन') > -1);
    const html = await page.evaluate(() => document.getElementById('mig-devices').innerHTML);
    expect(html).toContain('⚠️');
    // पुराना version वाली row पहले (ऊपर) आनी चाहिए
    expect(html.indexOf('पुराना लाइनमैन')).toBeLessThan(html.indexOf('JE'));
  });
});

test.describe('चरण 3 — per-record write-path (_diffToPatch)', () => {
  test('बदले/नए/हटाए गए records का सही PATCH payload बनता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const prev = [
        { acc: '1', status: 'pending', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '3', status: 'paid', o: 2 },
      ];
      // acc:1 बदला (status), acc:2 वैसा ही रहा, acc:3 हटाया गया, acc:4 नया जुड़ा
      const arr = [
        { acc: '1', status: 'paid', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '4', status: 'pending' },
      ];
      return _diffToPatch(prev, arr);
    });
    expect(r['1']).toEqual(expect.objectContaining({ status: 'paid' }));
    expect(r['2']).toBeUndefined(); // नहीं बदला — patch में नहीं आना चाहिए
    expect(r['3']).toBeNull(); // हटाया गया — null यानी delete
    expect(r['4']).toEqual(expect.objectContaining({ status: 'pending', o: 3 })); // नया — अगला क्रम मिला
  });

  test('कुछ न बदले तो खाली patch ({}) लौटे — कोई network call नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const list = [{ acc: '1', status: 'pending', o: 0 }];
      return _diffToPatch(list, JSON.parse(JSON.stringify(list)));
    });
    expect(r).toEqual({});
  });

  test('किसी record में acc न हो तो null (असुरक्षित — caller array-PUT पर वापस जाए)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => _diffToPatch([], [{ status: 'pending' }]));
    expect(r).toBeNull();
  });

  test('offline में fbSet — migrated HQ/श्रेणी पर पेंडिंग queue में सिर्फ patch बनता है, पूरी array नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      MIGRATED['टेस्ट_HQ'] = { 'कुल_उपभोक्ता': true };
    });
    const r = await page.evaluate(() => new Promise((resolve) => {
      cSet('टेस्ट HQ', 'कुल उपभोक्ता', [{ acc: '9', status: 'pending', o: 0 }]);
      fbSet('टेस्ट HQ', 'कुल उपभोक्ता', [{ acc: '9', status: 'paid', o: 0 }], function () {
        var p = getPending()['टेस्ट HQ_कुल उपभोक्ता'];
        resolve(p);
      });
    }));
    expect(r.patch).toBeTruthy();
    expect(r.patch['9']).toEqual(expect.objectContaining({ status: 'paid' }));
  });

  test('_applyPatchToArray — SSE "patch" event का delta local array पर सही लगता है (update/नया/हटाना)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const base = [
        { acc: '1', status: 'pending', o: 0 },
        { acc: '2', status: 'pending', o: 1 },
        { acc: '3', status: 'paid', o: 2 },
      ];
      return {
        updateOnly: _applyPatchToArray(base, { '1': { acc: '1', status: 'paid', o: 0 } }),
        addNew: _applyPatchToArray(base, { '4': { acc: '4', status: 'pending', o: 3 } }),
        removeOne: _applyPatchToArray(base, { '3': null }),
        mixed: _applyPatchToArray(base, { '1': { acc: '1', status: 'paid', o: 0 }, '3': null, '5': { acc: '5', status: 'pending', o: 4 } }),
      };
    });
    expect(r.updateOnly.find((x) => x.acc === '1').status).toBe('paid');
    expect(r.updateOnly.length).toBe(3);
    expect(r.addNew.length).toBe(4);
    expect(r.addNew.find((x) => x.acc === '4')).toBeTruthy();
    expect(r.removeOne.length).toBe(2);
    expect(r.removeOne.find((x) => x.acc === '3')).toBeFalsy();
    expect(r.mixed.length).toBe(3); // 3 base - 1 हटाया + 1 नया
    expect(r.mixed.find((x) => x.acc === '1').status).toBe('paid');
    expect(r.mixed.find((x) => x.acc === '3')).toBeFalsy();
    expect(r.mixed.find((x) => x.acc === '5')).toBeTruthy();
  });
});

test.describe('चरण 3 — migration-revert ऑटो-पहचान', () => {
  test('migrated flag true + data अब भी object हो, या flag ही false हो — तो कोई चेतावनी नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED['टेस्ट_HQ3'] = { 'कुल_उपभोक्ता': true };
      _checkMigrationRevert('टेस्ट HQ3', 'कुल उपभोक्ता', { '1': { acc: '1' } }); // object — ठीक है
      _checkMigrationRevert('टेस्ट HQ4', 'कुल उपभोक्ता', [{ acc: '1' }]); // migrated ही नहीं — कुछ जांचना नहीं
      return getLogs().filter((l) => l.c === 'migration-reverted');
    });
    expect(r.length).toBe(0);
  });

  test('migrated HQ का data array में मिले तो एक बार चेतावनी log होती है, बार-बार नहीं (गेट)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const logs = await page.evaluate(() => new Promise((resolve) => {
      try { localStorage.removeItem('dc_logs3'); } catch (e) {}
      MIGRATED['टेस्ट_HQ5'] = { 'कुल_उपभोक्ता': true };
      _checkMigrationRevert('टेस्ट HQ5', 'कुल उपभोक्ता', [{ acc: '1' }]); // पलटा हुआ — पहली बार
      _checkMigrationRevert('टेस्ट HQ5', 'कुल उपभोक्ता', [{ acc: '1' }]); // तुरंत दोबारा — गेट हो जाना चाहिए
      setTimeout(() => resolve(getLogs()), 300);
    }));
    expect(logs.filter((l) => l.c === 'migration-reverted').length).toBe(1);
  });

  test('_migRender — "पलटा हुआ" HQ को लाल चेतावनी के साथ अलग दिखाता है, और माइग्रेट बटन भी दिखता रहता है (मैन्युअल ठीक करने के लिए)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([{ hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, reverted: true } }]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('पलटा हुआ');
    expect(html).toContain('अपने आप ठीक होने की कोशिश करती हैं');
    // बग-फिक्स: पहले 'reverted' होने पर बटन पूरी तरह गायब हो जाता था — कोई मैन्युअल रास्ता नहीं बचता था
    expect(html).toContain('अभी माइग्रेट करें');
  });

  test('_migRender — सभी HQ/श्रेणी migrated हों तो "पूरी तरह माइग्रेट हो चुका है" दिखे, बटन नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: true } },
        { hq: 'आदेगांव', cat: 'व्यवसाय', a: { tot: 0, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: false } }, // खाली — गिनती में अड़चन नहीं
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('पूरी तरह माइग्रेट हो चुका है');
    expect(html).not.toContain('अभी माइग्रेट करें');
    expect(html).toContain('migrated');
  });

  test('_migRender — कुछ migrated, कुछ बाकी हों तो migrate बटन के साथ गिनती दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'आदेगांव', cat: 'कुल उपभोक्ता', a: { tot: 5, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: true } },
        { hq: 'पिंडरई', cat: 'कुल उपभोक्ता', a: { tot: 3, missingAcc: 0, dupAcc: 0, illegalAcc: 0, migrated: false } },
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('अभी माइग्रेट करें');
    expect(html).toContain('1 पहले से माइग्रेट');
  });
});

test.describe('Lineman PIN — सामान्य सुरक्षा-मज़बूती', () => {
  test('HQ का PIN सेट हो तो गलत PIN से login रुकता है, सही PIN से चलता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { HQ_PINS[hqKey('आदेगांव')] = '4321'; });
    await page.click('#rc-lin');
    await page.fill('#uname-inp', 'टेस्ट लाइनमैन');
    await page.selectOption('#hq-sel', { label: 'आदेगांव' });
    await page.fill('#lin-pin', '0000');
    await page.click('.login-btn');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
    await page.fill('#lin-pin', '4321');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('HQ का PIN सेट न हो तो बिना PIN login चलता रहता है (पुराना व्यवहार बरकरार)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(true);
  });

  test('सिर्फ JE "Lineman PIN" खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPinModal());
    expect(await page.evaluate(() => document.getElementById('pin-overlay').classList.contains('open'))).toBe(false);
  });

  test('savePins — सही HQ-key से PIN payload बनता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openPinModal());
    await page.fill('#pin-आदेगांव', '1111');
    const r = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/HQ_PIN.json') > -1 && opts && opts.method === 'PUT') {
          window.fetch = real;
          resolve({ body: JSON.parse(opts.body), key: hqKey('आदेगांव') });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      savePins();
    }));
    expect(r.body[r.key]).toBe('1111');
  });
});

test.describe('error logging', () => {
  test('logErr entry बनाता है और बिना पकड़ी error अपने आप log होती है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_logs3'); } catch (e) {} });
    await page.evaluate(() => logErr('test-ctx', new Error('जांच'), 'extra'));
    await page.evaluate(() => { setTimeout(() => { throw new Error('uncaught-जांच'); }, 0); });
    await page.waitForTimeout(500);
    const logs = await page.evaluate(() => getLogs());
    expect(logs.some((l) => l.c === 'test-ctx' && l.m.indexOf('जांच') > -1)).toBe(true);
    expect(logs.some((l) => l.c === 'js-error' && l.m.indexOf('uncaught') > -1)).toBe(true);
  });
});
