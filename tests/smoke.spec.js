// @ts-check
// वसूली ट्रैकर — smoke tests
// हर बाहरी request (CDN/Firebase/Google) block की जाती है ताकि:
//  1. tests कभी असली production database को न छुएं
//  2. app का offline-first रास्ता भी हर PR पर अपने आप जांचा जाए
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

  test('कंज्यूमर कार्ड लिस्ट लंबी हो तो .main-scroll ही अंदर scroll करे, पूरा पेज नहीं (कार्ड scroll न होने वाला bug)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var list = document.getElementById('con-list');
      var html = '';
      for (var i = 0; i < 60; i++) {
        html += '<div class="con-card"><div class="cc-top"><div class="cc-name">टेस्ट उपभोक्ता ' + i + '</div></div><div class="cc-amt">1000</div></div>';
      }
      list.innerHTML = html;
    });
    const dims = await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      return {
        mainScrollScrollable: ms.scrollHeight > ms.clientHeight,
        docScrollable: document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 5,
      };
    });
    expect(dims.mainScrollScrollable).toBe(true);
    expect(dims.docScrollable).toBe(false); // पूरा पेज/body scroll न करे — सिर्फ़ अंदर की लिस्ट
    await page.evaluate(() => { document.querySelector('.main-scroll').scrollTop = 300; });
    expect(await page.evaluate(() => document.querySelector('.main-scroll').scrollTop)).toBeGreaterThan(0);
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

  test('login session reload में बना रहे — pull-to-refresh जैसा असली page reload दोबारा login न मांगे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'रिलोड लाइनमैन');
    expect(await page.evaluate(() => sessionStorage.getItem('dc_cu'))).toContain('रिलोड लाइनमैन');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => document.getElementById('login-screen').classList.contains('active'))).toBe(false);
    expect(await page.evaluate(() => CU && CU.name)).toBe('रिलोड लाइनमैन');
    // चुपचाप वापस आया — "स्वागत है" toast दोबारा न दिखे
    expect(await page.evaluate(() => document.getElementById('toast').classList.contains('show'))).toBe(false);
  });

  test('explicit logout के बाद session साफ़ हो जाए — अगला reload login screen पर ही रुके', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => doLogout(false));
    expect(await page.evaluate(() => sessionStorage.getItem('dc_cu'))).toBeNull();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('html/body और सभी scroll-containers पर overscroll-behavior-y सेट रहे — वरना native pull-to-refresh पूरा पेज reload करके गलती से logout कर देती है (v9.62 के structural scroll-fix में यह चुपचाप गायब हो गया था, बिना test के किसी को पता नहीं चला)', async ({ page }) => {
    await openApp(page);
    const val = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
    expect(val).toBe('none');
    await loginLineman(page);
    const containers = ['.main-scroll', '.msheet', '.preview-box', '.prev-rmk-list', '.log-list'];
    for (const sel of containers) {
      const cv = await page.evaluate((s) => {
        var el = document.querySelector(s);
        return el ? getComputedStyle(el).overscrollBehaviorY : null;
      }, sel);
      expect(cv, sel + ' पर overscroll-behavior-y होना चाहिए').toBe('contain');
    }
  });

  test('"वापस" बटन से बार-बार पीछे जाकर login screen तक पहुंचने पर logout से पहले पूछे — बिना पूछे logout जैसा महसूस न हो (v9.59)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    // goBack पहले activeCat को "घरेलू" पर रीसेट करके रुक जाता है (पहले श्रेणी पर लौटना पहला कदम है) —
    // यहां सीधे उस अवस्था पर पहुंचकर logout-confirm वाला अगला कदम जांचते हैं
    await page.evaluate(() => { activeCat = "घरेलू"; });
    const askedMsg = await page.evaluate(() => new Promise((resolve) => {
      var msg = null;
      window.confirm = function (m) { msg = m; return false; }; // 'नहीं' चुना
      document.getElementById('back-btn').click();
      setTimeout(() => resolve(msg), 200);
    }));
    expect(askedMsg).toContain('लॉगआउट');
    // 'नहीं' चुनने पर app-screen पर ही रहे
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(true);

    await page.evaluate(() => { window.confirm = function () { return true; }; }); // 'हां' चुना
    await page.click('#back-btn');
    await page.waitForFunction(() => document.getElementById('login-screen').classList.contains('active'), null, { timeout: 15000 });
  });
});

test.describe('बॉटम नेव auto-hide — लिस्ट scroll करते समय Profile/Support पट्टी छुपे, सिर्फ़ आखिर में दिखे', () => {
  test('स्क्रॉल के दौरान bnav-hidden लगे, बिल्कुल नीचे पहुंचने पर हट जाए, बीच में वापस जाने पर फिर लगे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var list = document.getElementById('con-list');
      var html = '';
      for (var i = 0; i < 60; i++) {
        html += '<div class="con-card" style="height:80px;"><div class="cc-top"><div class="cc-name">टेस्ट उपभोक्ता ' + i + '</div></div></div>';
      }
      list.innerHTML = html;
    });
    // शुरुआत में सबसे ऊपर — bnav छुपी होनी चाहिए (आखिर तक नहीं पहुंचे)
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = 0;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(true);

    // बिल्कुल नीचे — bnav दिखनी चाहिए
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = ms.scrollHeight;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(false);

    // बीच में वापस — फिर छुप जाए
    await page.evaluate(() => {
      var ms = document.querySelector('.main-scroll');
      ms.scrollTop = 100;
      ms.dispatchEvent(new Event('scroll'));
    });
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(true);
  });

  test('खाली लिस्ट में (scroll की ज़रूरत ही नहीं) bnav हमेशा दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    // _updateBnavVisibility अगले paint frame तक टलता है (देखें js/list.js) — उसका इंतज़ार करें
    await page.evaluate(() => new Promise((resolve) => {
      activeFilter = 'paid'; renderList(); // कोई paid record नहीं — खाली दिखेगा
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    expect(await page.evaluate(() => document.querySelector('.bottom-nav').classList.contains('bnav-hidden'))).toBe(false);
  });
});

test.describe('रोल-आधारित UI', () => {
  test('JE को dropdown में चारों tools दिखते हैं, lineman को नहीं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const jeVisible = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item', 'usage-menu-item']
        .every((id) => document.getElementById(id).style.display !== 'none'));
    expect(jeVisible).toBe(true);
    await page.evaluate(() => doLogout(false));
    await loginLineman(page);
    const linHidden = await page.evaluate(() =>
      ['hsc-menu-item', 'cash-menu-item', 'log-menu-item', 'backup-menu-item', 'wasc-menu-item', 'mig-menu-item', 'usage-menu-item']
        .every((id) => document.getElementById(id).style.display === 'none'));
    expect(linHidden).toBe(true);
  });

  test('profile-मेनू के आइटम असली <button> हैं — कीबोर्ड/स्क्रीन-रीडर से भी इस्तेमाल हो सकें (accessibility)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const tags = await page.evaluate(() =>
      ['hsc-menu-item', 'wasc-menu-item', 'village-menu-item', 'cash-menu-item', 'backup-menu-item', 'log-menu-item', 'usage-menu-item', 'mig-menu-item', 'pin-menu-item']
        .map((id) => document.getElementById(id).tagName));
    expect(tags.every((t) => t === 'BUTTON')).toBe(true);
  });

  test('profile-मेनू का "स्कोरकार्ड डिस्प्ले" दबाने पर सही मॉडल खुले, गलती से नीचे का hq-tab न दब जाए (z-index bug)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const hqBefore = await page.evaluate(() => activeHQ);
    await page.click('.user-pill');
    await page.click('#wasc-menu-item');
    expect(await page.evaluate(() => document.getElementById('wasc-overlay').classList.contains('open'))).toBe(true);
    expect(await page.evaluate(() => activeHQ)).toBe(hqBefore); // नीचे का hq-tab गलती से न दब जाए
  });

  test('profile-मेनू का "होम पेज डिस्प्ले बोर्ड" दबाने पर सही मॉडल खुले, गलती से नीचे का hq-tab न दब जाए (z-index bug)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const hqBefore = await page.evaluate(() => activeHQ);
    await page.click('.user-pill');
    await page.click('#hsc-menu-item');
    expect(await page.evaluate(() => document.getElementById('hsc-overlay').classList.contains('open'))).toBe(true);
    expect(await page.evaluate(() => activeHQ)).toBe(hqBefore);
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

  test('दिनांक-वार वसूली (buildScOverview) — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200 },
      ]);
      buildScOverview(['आदेगांव']);
      return document.getElementById('sc-overview').textContent;
    });
    expect(txt).toContain('1कुल उपभोक्ता');
    expect(txt).toContain('0✅ वसूल');
  });

  test('दिनांक-वार वसूली (renderScDateTable) — "कुल उपभोक्ता" में न हो ऐसे paid acc को न गिने', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const txt = await page.evaluate(() => {
      scActiveHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'रामपुर', status: 'pending', amount: 100 },
      ]);
      cSet('आदेगांव', 'घरेलू', [
        { acc: '99', status: 'paid', amount: 200, paydate: '1/1/2026' },
      ]);
      renderScDateTable(cGet('आदेगांव', 'घरेलू'));
      return document.getElementById('sc-body').textContent;
    });
    expect(txt).toContain('कोई वसूली नहीं'); // acc '99' मास्टर सूची में नहीं — कोई paid record नहीं बचना चाहिए
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

  test('रिमार्क मोडल खुला रहते हुए लिस्ट का क्रम बदल जाए (background sync) — फिर भी सही record में सेव हो, acc से मिलान करके', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    // राम कुमार (idx 0, acc 111222) का रिमार्क मोडल खोलें
    await page.evaluate(() => openRmkModal(0, '111222'));
    await expect(page.locator('#rmk-name')).toHaveText('राम कुमार');
    // मोडल खुला रहते हुए — background sync ने क्रम पलट दिया, अब idx 0 पर श्याम लाल है
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '333444', name: 'श्याम लाल', status: 'pending', amount: 700 },
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
      ]);
    });
    await page.fill('#rmk-text', 'टेस्ट रिमार्क');
    await page.evaluate(() => saveRmk());
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => cGet('आदेगांव', 'कुल उपभोक्ता'));
    const ram = data.find((x) => x.acc === '111222');
    const shyam = data.find((x) => x.acc === '333444');
    expect(ram.remarksArr && ram.remarksArr[0].text).toBe('टेस्ट रिमार्क'); // सही व्यक्ति (राम) पर लगा
    expect(shyam.remarksArr).toBeFalsy(); // गलती से श्याम पर नहीं लगा
  });

  test('रिमार्क मोडल खुला रहते हुए वह record ही हट जाए — चुपचाप fail न हो, साफ़ error दिखे', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '111222', name: 'राम कुमार', status: 'pending', amount: 500 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('राम कुमार', { timeout: 15000 });
    await page.evaluate(() => openRmkModal(0, '111222'));
    // background sync ने वह record ही हटा दिया (जैसे JE ने लिस्ट दोबारा अपलोड कर दी हो)
    await page.evaluate(() => { cSet('आदेगांव', 'कुल उपभोक्ता', []); });
    await page.fill('#rmk-text', 'टेस्ट रिमार्क');
    await page.evaluate(() => saveRmk());
    await page.waitForTimeout(300);
    await expect(page.locator('#toast')).toContainText('अब सूची में नहीं मिला');
  });

  test('रिमार्क सेव migrated (per-record) HQ पर वाकई Firebase को PATCH भेजे — सिर्फ़ local cache में दिखकर न रह जाए (prev/arr reference-aliasing bug)', async ({ page }) => {
    // असली production bug: cGet() जो array लौटाता है वही object cSet() में वापस स्टोर होता है, तो
    // fbSet() के अंदर पुराना cGet()-आधारित prev capture हमेशा नई (already-mutated) value ही देखता था —
    // यानी prev === arr, और _diffToPatch को कभी कोई फ़र्क़ नहीं दिखता — patch हमेशा खाली, PATCH भेजा
    // ही नहीं जाता। रिमार्क सिर्फ़ local cache/localStorage में दिखता, अगली असली server sync में गायब
    // हो जाता — user को लगता "सेव हुआ" पर असल में कभी Firebase तक पहुंचा ही नहीं।
    await openApp(page);
    await page.evaluate(() => {
      MIGRATED[hqKey('आदेगांव')] = {};
      MIGRATED[hqKey('आदेगांव')][catKey('कुल उपभोक्ता')] = true;
      cSet('आदेगांव', 'कुल उपभोक्ता', [
        { acc: '555666', name: 'गीता देवी', status: 'pending', amount: 300, o: 0 },
      ]);
    });
    await loginLineman(page);
    await expect(page.locator('.con-card').first()).toContainText('गीता देवी', { timeout: 15000 });
    const sentBody = await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('आदेगांव/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PATCH') {
          resolve(JSON.parse(opts.body));
        }
        return orig(url, opts);
      };
      openRmkModal(0, '555666');
      document.getElementById('rmk-text').value = 'बकाया माफ़ी की मांग';
      saveRmk();
      setTimeout(() => resolve(null), 5500);
    }));
    expect(sentBody).toBeTruthy(); // PATCH भेजा ही नहीं गया तो यहीं fail होगा
    expect(sentBody['555666']).toBeTruthy();
    expect(sentBody['555666'].remarksArr[0].text).toBe('बकाया माफ़ी की मांग');
  });

  test('कैश लिस्ट: नया-पुराना timestamp नियम (बोर्ड टकराव)', async ({ page }) => {
    await openApp(page);
    await loginJE(page); // असली publish (PUT) सिर्फ़ JE कर सकता है — _hscRetryPublish अब यह जांचता है
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

  test('HQ-वार sheet में टैरिफ श्रेणी का कॉलम भी शामिल होता है', async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      cSet('जोबा', 'कुल उपभोक्ता', [
        { acc: '1', addr: 'PIPARIYA', name: 'राम', status: 'paid', amount: 100, tariff: 'LV1.1' },
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
        writeFile: function (wb) { res({ sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    const tariffCol = jobaSheet.rows[0].indexOf('टैरिफ');
    expect(tariffCol).toBeGreaterThan(-1);
    expect(jobaSheet.rows[1][tariffCol]).toBe('LV1.1');
  });

  test('लंबे नाम/गांव के लिए कॉलम अपने-आप चौड़ा होता है — अक्षर कटने न पाएं', async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page);
    await loginJE(page);
    await page.waitForTimeout(2000);
    const longName = 'राजेन्द्र कुमार शर्मा विश्वकर्मा पुत्र स्वर्गीय';
    await page.evaluate((n) => {
      cSet('जोबा', 'कुल उपभोक्ता', [{ acc: '1', addr: 'PIPARIYA', name: n, status: 'pending', amount: 100 }]);
    }, longName);
    const r = await page.evaluate(() => new Promise((res) => {
      var sheets = [];
      window.XLSX = {
        utils: {
          book_new: function () { return { SheetNames: [], Sheets: {} }; },
          aoa_to_sheet: function (a) { return { rows: a }; },
          book_append_sheet: function (wb, ws, nm) { wb.SheetNames.push(nm); wb.Sheets[nm] = ws; sheets.push({ name: nm, cols: ws['!cols'], rows: ws.rows }); },
        },
        writeFile: function (wb) { res({ sheets: sheets }); },
      };
      downloadVillageExcel();
    }));
    const jobaSheet = r.sheets.find((s) => s.name === 'जोबा');
    const nameCol = jobaSheet.rows[0].indexOf('नाम');
    // कॉलम की चौड़ाई नाम की लंबाई से काफ़ी कम न रहे (Consumer No/तारीख जैसे narrow कॉलम की गलती न दोहराए)
    expect(jobaSheet.cols[nameCol].wch).toBeGreaterThan(longName.length * 0.9);
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

  test('_migAnalyzeList — acc खाली वाले record की नाम/पता/मोबाइल से पहचान (missingAccSamples) देता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => _migAnalyzeList([
      { acc: '1', name: 'राम कुमार' },
      { name: 'श्याम लाल', addr: 'PIPARIYA', phone: '9876543210' }, // acc ही नहीं
    ]));
    expect(r.missingAcc).toBe(1);
    expect(r.missingAccSamples).toEqual([{ name: 'श्याम लाल', addr: 'PIPARIYA', phone: '9876543210' }]);
  });

  test('_migRender — "समस्या वाले records" सूची में नाम/पता दिखाकर JE को ढूंढना आसान बनाता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openMigModal());
    await page.evaluate(() => {
      _migRender([
        { hq: 'पाटन', cat: 'घरेलू', a: { tot: 5, missingAcc: 1, missingAccSamples: [{ name: 'श्याम लाल', addr: 'PIPARIYA', phone: '' }], dupAcc: 0, illegalAcc: 0 } },
      ]);
    });
    const html = await page.evaluate(() => document.getElementById('mig-content').innerHTML);
    expect(html).toContain('समस्या वाले records');
    expect(html).toContain('श्याम लाल');
    expect(html).toContain('PIPARIYA');
    expect(html).toContain('Consumer No खाली');
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
      fbSet('टेस्ट HQ', 'कुल उपभोक्ता', [{ acc: '9', status: 'paid', o: 0 }], [{ acc: '9', status: 'pending', o: 0 }], function () {
        var p = getPending()['टेस्ट HQ_कुल उपभोक्ता'];
        resolve(p);
      });
    }));
    expect(r.patch).toBeTruthy();
    expect(r.patch['9']).toEqual(expect.objectContaining({ status: 'paid' }));
  });

  test('_fbPut (legacy array-PUT rasta) migrated HQ/श्रेणी पर कभी raw array नहीं भेजता — acc-रहित record छोड़कर बाकी object फॉर्मेट में', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      MIGRATED['टेस्ट_HQ6'] = { 'कुल_उपभोक्ता': true };
      let sentBody = null;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ6/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          sentBody = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ6', 'कुल उपभोक्ता', [
        { acc: '1', status: 'pending', o: 0 },
        { status: 'pending' }, // acc नहीं — सुरक्षित रूप से छोड़ा जाना चाहिए
        { acc: '2', status: 'paid', o: 1 },
      ], function () {
        window.fetch = orig;
        resolve(sentBody);
      });
    }));
    expect(Array.isArray(r)).toBe(false); // array नहीं — object होना चाहिए
    expect(Object.keys(r).sort()).toEqual(['1', '2']);
    expect(r['1'].status).toBe('pending');
    expect(r['2'].status).toBe('paid');
  });

  test('_fbPut — migrated ही न हो तो हमेशा की तरह plain array भेजता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let sentBody = null;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ7/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          sentBody = JSON.parse(opts.body);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ7', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve(sentBody);
      });
    }));
    expect(Array.isArray(r)).toBe(true);
  });

  test('_fbPut — save 401 पर रुके तो "ऑफलाइन" नहीं, साफ़ "दोबारा login करें" वाला toast दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ8', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve();
      });
    }));
    await expect(page.locator('#toast')).toContainText('login session');
    await expect(page.locator('#toast')).not.toContainText('ऑफलाइन');
  });

  test('_fbPut — नेटवर्क fail (जैसा offline में होता है) हो तो पुराना "ऑफलाइन" वाला toast ही दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ9/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PUT') {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return orig(url, opts);
      };
      _fbPut('टेस्ट HQ9', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending' }], function () {
        window.fetch = orig;
        resolve();
      });
    }));
    await expect(page.locator('#toast')).toContainText('ऑफलाइन');
  });

  test('लगातार 401 (गलत HQ/account का device) — कुछ बार के बाद auto-retry रुक जाए, हमेशा के लिए hammer न करे', async ({ page }) => {
    // असली production log में यह exact पैटर्न मिला: एक लाइनमैन के device पर किसी और HQ का pending
    // बदलाव बचा रह गया था, जो कभी सफल नहीं हो सकता था (401 permission-denied) — फिर भी हर 20 सेकंड
    // दोबारा कोशिश होती रही, घंटों तक। यह टेस्ट पुष्टि करता है कि STUCK_AUTH_MAX बार बाद रुक जाए।
    await openApp(page);
    await loginJE(page);
    // toast() को असली login-welcome toast के साथ रेस से बचाने के लिए यहीं (उसी evaluate के अंदर,
    // बिना किसी async gap के) toast का टेक्स्ट भी capture कर लेते हैं — polling assert में देर होने पर
    // बाद में आया कोई और (असंबंधित, जैसे देर से आया login-welcome) toast बीच में overwrite कर सकता था
    const r = await page.evaluate(() => new Promise((resolve) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true });
      let count = 0;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ10/कुल_उपभोक्ता') > -1 && opts && opts.method === 'PATCH') {
          count++;
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      // असली बदलाव जैसा — कोई मौजूदा record बदला (नया/हटाया record नहीं, ताकि PATCH-path भी सही exercise हो)
      MIGRATED[hqKey('टेस्ट HQ10')] = {}; MIGRATED[hqKey('टेस्ट HQ10')][catKey('कुल उपभोक्ता')] = true;
      cSet('टेस्ट HQ10', 'कुल उपभोक्ता', [{ acc: '1', status: 'pending', o: 0 }]);
      fbSet('टेस्ट HQ10', 'कुल उपभोक्ता', [{ acc: '1', status: 'paid', o: 0 }], [{ acc: '1', status: 'pending', o: 0 }], function () {
        // पहला असल-save-attempt फेल हुआ, अब जान-बूझकर कई बार flushPending बुलाओ (जैसे हर 20 सेकंड वाला टाइमर करता)
        function loop(n) {
          if (n <= 0) {
            window.fetch = orig;
            resolve({ count: count, toastText: document.getElementById('toast').textContent });
            return;
          }
          flushPending();
          setTimeout(function () { loop(n - 1); }, 50);
        }
        loop(6);
      });
    }));
    // 1 असली save-attempt + STUCK_AUTH_MAX तक पहुंचने के लिए ज़रूरी retries — उसके बाद कोई नया PATCH नहीं जाना चाहिए
    expect(r.count).toBe(3);
    expect(r.toastText).toContain('भेजे नहीं जा पा रहे');
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

test.describe('बकाया ≤0 अपने-आप वसूल — migration-aware push', () => {
  test('overlayOps — amount<=0 वाले records एक ही बार paid बनते हैं (दोहराव नहीं)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      var data = [
        { acc: '1', status: 'pending', amount: 0 },
        { acc: '2', status: 'pending', amount: -50 },
        { acc: '3', status: 'pending', amount: 100 },
      ];
      var applied = overlayOps('टेस्ट HQ1', 'कुल उपभोक्ता', data);
      return { applied: applied, data: data };
    });
    expect(r.applied).toBe(2);
    expect(r.data[0].status).toBe('paid');
    expect(r.data[1].status).toBe('paid');
    expect(r.data[2].status).toBe('pending');
  });

  test('migrated HQ पर सिर्फ बदले acc का PATCH भेजा जाता है — पूरी array नहीं (bug-fix — पहले यह चुपचाप migration पलट देता था)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      MIGRATED[hqKey('टेस्ट HQ2')] = {}; MIGRATED[hqKey('टेस्ट HQ2')][catKey('कुल उपभोक्ता')] = true;
    });
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('टेस्ट_HQ2') > -1) {
          window.fetch = real;
          resolve({ method: opts.method, body: JSON.parse(opts.body) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      var data = [
        { acc: '5', status: 'pending', amount: 0 },
        { acc: '6', status: 'pending', amount: 100 },
      ];
      overlayOps('टेस्ट HQ2', 'कुल उपभोक्ता', data);
    }));
    expect(call.method).toBe('PATCH');
    expect(Object.keys(call.body)).toEqual(['5']); // सिर्फ बदला हुआ acc — '6' (जो नहीं बदला) शामिल नहीं
    expect(call.body['5']).toEqual(expect.objectContaining({ status: 'paid' }));
  });

  test('migrated न हो तो पुराने तरीके से (पूरी array PUT) भेजा जाता है', async ({ page }) => {
    await openApp(page);
    const call = await page.evaluate(() => new Promise((resolve) => {
      const real = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('टेस्ट_HQ3') > -1) {
          window.fetch = real;
          resolve({ method: opts.method });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(true) });
        }
        return real(url, opts);
      };
      cSet('टेस्ट HQ3', 'कुल उपभोक्ता', []);
      var data = [{ acc: '7', status: 'pending', amount: 0 }];
      overlayOps('टेस्ट HQ3', 'कुल उपभोक्ता', data);
    }));
    expect(call.method).toBe('PUT');
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

  test('logout पर PIN फ़ील्ड भी साफ़ हो जाए — वरना shared device पर अगले लाइनमैन को पुराने PIN से login fail दिखता (गड़बड़ी जो "logout ठीक से काम नहीं करता" जैसी दिखती थी)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { HQ_PINS[hqKey('आदेगांव')] = '4321'; });
    await page.click('#rc-lin');
    await page.fill('#uname-inp', 'टेस्ट लाइनमैन');
    await page.selectOption('#hq-sel', { label: 'आदेगांव' });
    await page.fill('#lin-pin', '4321');
    await page.click('.login-btn');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    await page.evaluate(() => doLogout(false));
    expect(await page.locator('#lin-pin').inputValue()).toBe('');
    expect(await page.locator('#uname-inp').inputValue()).toBe('');
    expect(await page.locator('#hq-sel').inputValue()).toBe('');
  });

  test('सही PIN पर उस HQ के असली Firebase account से sign-in होता है (email + PIN से बना password)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function (email, pw) {
            resolve({ email: email, pw: pw });
            return Promise.resolve({});
          },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    }));
    expect(r.email).toBe('hq-adegaon@adegaondc.internal');
    expect(r.pw).toBe('vasuli-4321');
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
  });

  test('HQ sign-in reject (गलत password/server) हो तो login रुक जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/wrong-password' }); },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getElementById('app-screen').classList.contains('active'))).toBe(false);
  });

  test('HQ sign-in के बीच नेट टूटे तो भी login आगे बढ़ जाता है (offline-सहनशील)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HQ_PINS[hqKey('आदेगांव')] = '4321';
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return {
          currentUser: null,
          signInWithEmailAndPassword: function () { return Promise.reject({ code: 'auth/network-request-failed' }); },
        };
      };
      selectRole('lineman');
      document.getElementById('uname-inp').value = 'टेस्ट लाइनमैन';
      document.getElementById('hq-sel').value = 'आदेगांव';
      document.getElementById('lin-pin').value = '4321';
      doLogin();
    });
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

test.describe('Firebase auth token — 401 पर force-refresh', () => {
  test('_fbFetchWithAuth — 401 मिलने पर token force-refresh करके एक बार दोबारा कोशिश करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () {
        calls++;
        if (calls === 1) return Promise.resolve({ status: 401, ok: false });
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
      };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { currentUser: { getIdToken: function () { ID_TOKEN = 'fresh-token'; return Promise.resolve('fresh-token'); } } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status, token: ID_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.token).toBe('fresh-token');
  });

  test('_fbFetchWithAuth — currentUser न हो तो 401 response वैसे ही लौटा देता है (दोबारा कोशिश नहीं, loop नहीं)', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 401, ok: false }); };
      window.firebase = window.firebase || {};
      window.firebase.auth = function () { return { currentUser: null }; };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(1);
    expect(r.status).toBe(401);
  });

  test('_fbFetchWithAuth — सामान्य (non-401) response पर सिर्फ एक ही बार fetch करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) }); };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(1);
    expect(r.status).toBe(200);
  });

  test('_fbFetchWithAuth — 403 मिलने पर App Check token force-refresh करके एक बार दोबारा कोशिश करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () {
        calls++;
        if (calls === 1) return Promise.resolve({ status: 403, ok: false });
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
      };
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return { getToken: function () { AC_TOKEN = 'fresh-ac-token'; return Promise.resolve({ token: 'fresh-ac-token' }); } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status, token: AC_TOKEN });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.token).toBe('fresh-ac-token');
  });

  test('_fbFetchWithAuth — 403 पर retry भी असफल रहे (असली permission-denied) तो वही response लौटाता है, loop नहीं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      let calls = 0;
      _rawFetch = function () { calls++; return Promise.resolve({ status: 403, ok: false }); };
      window.firebase = window.firebase || {};
      window.firebase.appCheck = function () {
        return { getToken: function () { return Promise.resolve({ token: 'x' }); } };
      };
      _fbFetchWithAuth(FB + '/test.json', { method: 'GET' }).then((res) => {
        resolve({ calls: calls, status: res.status });
      });
    }));
    expect(r.calls).toBe(2);
    expect(r.status).toBe(403);
  });
});

test.describe('लॉगिन और डेटा-लोड — कमज़ोर नेटवर्क पर हमेशा के लिए न अटकें', () => {
  test('verifyJE — online सर्वर जवाब न दे तो timeout के बाद offline hash से login हो जाता है', async ({ page }) => {
    await openApp(page);
    await page.evaluate((p) => new Promise((res) => {
      _sha256('dcje|' + p).then((h) => { try { localStorage.setItem('dc_jeh', h); } catch (e) {} res(); });
    }), 'Test#123');
    const r = await page.evaluate(() => new Promise((resolve) => {
      JE_VERIFY_TIMEOUT_MS = 200;
      window.firebase = window.firebase || {};
      window.firebase.auth = function () {
        return { signInWithEmailAndPassword: function () { return new Promise(() => {}); } }; // कभी जवाब नहीं
      };
      const start = Date.now();
      verifyJE('Test#123', function (ok, msg) {
        resolve({ ok: ok, msg: msg, ms: Date.now() - start });
      });
    }));
    expect(r.ok).toBe(true);
    expect(r.ms).toBeLessThan(2000);
  });

  test('fbGet — cache खाली हो और नेटवर्क धीमा हो तो timeout के बाद खाली लिस्ट के साथ आगे बढ़ता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      FB_GET_TIMEOUT_MS = 200;
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ9/घरेलू') > -1) {
          return new Promise(() => {}); // कभी resolve नहीं — अटकी हुई श्रेणी
        }
        return orig(url, opts);
      };
      const start = Date.now();
      fbGet('टेस्ट HQ9', 'घरेलू', function (data) {
        window.fetch = orig;
        resolve({ ms: Date.now() - start, len: data.length });
      });
    }));
    expect(r.ms).toBeLessThan(2000);
    expect(r.len).toBe(0);
  });
});

test.describe('_cashRefreshAll — कमज़ोर नेटवर्क पर एक अटकी श्रेणी पूरी स्क्रीन को न रोके', () => {
  test('एक श्रेणी का fetch कभी जवाब न दे तो भी timeout के बाद पुरानी cache के साथ आगे बढ़ता है, बाकी अपडेट होती हैं', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => new Promise((resolve) => {
      _CASH_REFRESH_TIMEOUT_MS = 200; // टेस्ट में तेज़ जांच के लिए छोटा
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8/घरेलू') > -1) {
          return new Promise(() => {}); // कभी resolve/reject नहीं होगा — अटकी हुई श्रेणी
        }
        if (typeof url === 'string' && url.indexOf('टेस्ट_HQ8') > -1) {
          return Promise.resolve({ json: () => Promise.resolve([{ acc: '1', status: 'pending' }]) });
        }
        return orig(url, opts);
      };
      cSet('टेस्ट HQ8', 'घरेलू', [{ acc: 'OLD', status: 'pending' }]); // अटकी श्रेणी की पुरानी cache
      const start = Date.now();
      _cashRefreshAll(['टेस्ट HQ8'], function () {
        window.fetch = orig;
        resolve({
          ms: Date.now() - start,
          stuckStillOld: cGet('टेस्ट HQ8', 'घरेलू')[0].acc === 'OLD',
          othersUpdated: cGet('टेस्ट HQ8', 'कुल उपभोक्ता')[0].acc === '1',
        });
      });
    }));
    expect(r.ms).toBeLessThan(2000);
    expect(r.stuckStillOld).toBe(true);
    expect(r.othersUpdated).toBe(true);
  });
});

test.describe('अपडेट बैनर — नया version आने पर रीलोड prompt', () => {
  test('_showUpdateBanner — बैनर दिखता है, दोबारा बुलाने पर डुप्लीकेट नहीं बनता, बटन रीलोड करता है', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      _showUpdateBanner();
      _showUpdateBanner(); // दोबारा — डुप्लीकेट नहीं बनना चाहिए
      const banners = document.querySelectorAll('#update-banner');
      const btn = document.getElementById('update-banner-btn');
      return { count: banners.length, text: document.getElementById('update-banner').textContent, hasBtn: !!btn, hasOnclick: typeof btn.onclick === 'function' };
    });
    expect(r.count).toBe(1);
    expect(r.text).toContain('नया version');
    expect(r.hasBtn).toBe(true);
    expect(r.hasOnclick).toBe(true);
  });

  test('_swSetupAutoUpdate — tab वापस visible होने पर reg.update() ख़ुद बुलाया जाए (browser के अपने-आप घंटों बाद जांचने का इंतज़ार न करना पड़े)', async ({ page }) => {
    await openApp(page);
    const called = await page.evaluate(() => {
      return new Promise((resolve) => {
        var updateCalls = 0;
        var fakeReg = { update: function () { updateCalls++; return Promise.resolve(); } };
        _swSetupAutoUpdate(fakeReg);
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        setTimeout(function () { resolve(updateCalls); }, 50);
      });
    });
    expect(called).toBeGreaterThan(0);
  });
});

test.describe('PWA installable — manifest + icons', () => {
  test('_headers — sw.js/index.html कभी भी browser/CDN/मोबाइल-नेटवर्क से cache न हों (bug: device पुराने version पर हमेशा के लिए अटक जाना)', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');
    const noCacheFor = (route) => {
      const idx = content.indexOf(route + '\n');
      expect(idx, route + ' के लिए _headers में rule होना चाहिए').toBeGreaterThan(-1);
      const block = content.slice(idx, idx + 200);
      expect(block).toMatch(/Cache-Control:\s*no-cache/);
    };
    noCacheFor('/sw.js');
    noCacheFor('/index.html');
  });

  test('index.html में manifest लिंक है और manifest.json सही/मान्य है', async ({ page }) => {
    await openApp(page);
    const href = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href'));
    expect(href).toBe('manifest.json');
    const manifest = await page.evaluate(() => fetch('manifest.json').then((r) => r.json()));
    expect(manifest.name).toContain('वसूली ट्रैकर');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const res = await page.evaluate((src) => fetch(src).then((r) => r.status), icon.src);
      expect(res).toBe(200);
    }
  });

  test('apple-touch-icon लिंक मौजूद है और फ़ाइल लोड होती है', async ({ page }) => {
    await openApp(page);
    const href = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    expect(href).toBeTruthy();
    const status = await page.evaluate((src) => fetch(src).then((r) => r.status), href);
    expect(status).toBe(200);
  });

  test('viewport pinch-zoom बंद न हो — कमज़ोर नज़र वाले उपयोगकर्ता टेक्स्ट बड़ा कर सकें (accessibility)', async ({ page }) => {
    await openApp(page);
    const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content'));
    expect(content).not.toContain('user-scalable=no');
    expect(content).not.toMatch(/maximum-scale=1(\.0)?\b/);
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

  test('cross-origin वाली खाली "Script error." लॉग नहीं होती (कोई सुराग नहीं देती, सिर्फ़ शोर) — पर असली errors लॉग होती रहती हैं', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('dc_logs3'); } catch (e) {} });
    // ब्राउज़र cross-origin script की error पर बिल्कुल यही खाली signature देता है — filename/lineno/error कुछ नहीं
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null }));
    });
    // असली (हमारे कोड जैसी, filename/lineno सहित) error अब भी सामान्य तरीके से लॉग होनी चाहिए
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'असली गड़बड़ी', filename: 'js/list.js', lineno: 42, error: new Error('असली गड़बड़ी') }));
    });
    await page.waitForTimeout(200);
    const logs = await page.evaluate(() => getLogs());
    expect(logs.some((l) => l.c === 'js-error' && l.m === 'Script error.')).toBe(false);
    expect(logs.some((l) => l.c === 'js-error' && l.m.indexOf('असली गड़बड़ी') > -1)).toBe(true);
  });

  test('clearServerLogs — "सभी डिवाइस" वाले (server) logs को DELETE करता है, ताकि JE पुराने ढेर से छुटकारा पा सके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openLogModal());
    const deletedPaths = await page.evaluate(() => new Promise((resolve) => {
      const deleted = [];
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/LOGS/') > -1 && opts && opts.method === 'DELETE') {
          deleted.push(url);
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      window.confirm = () => true;
      clearServerLogs();
      setTimeout(() => { window.fetch = orig; resolve(deleted); }, 300);
    }));
    // आज + कल — दोनों दिन के server logs हटने चाहिए (fetchServerLogs जिन 2 दिन को दिखाता है, वही)
    expect(deletedPaths.length).toBe(2);
    await expect(page.locator('#toast')).toContainText('साफ़ हो गए');
  });

  test('refreshLogBadge — पिछली बार देखने के बाद नई server error आई हो तो "एरर लॉग" पर गिनती वाला बैज दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { localStorage.setItem('dc_log_seen_ts', String(Date.now() - 60000)); }); // 1 मिनट पहले देखा था
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/LOGS/') > -1 && (!opts || !opts.method)) {
          const today = new Date().toISOString().slice(0, 10);
          const isToday = url.indexOf('/LOGS/' + today) > -1;
          const data = isToday ? { a: { t: new Date().toISOString(), c: 'js-error', m: 'नई गड़बड़ी' } } : null;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        }
        return orig(url, opts);
      };
      refreshLogBadge();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    // badge profile-menu (बंद dropdown) के अंदर है, इसलिए ancestor-visibility नहीं — सिर्फ़ अपनी inline style जांचें
    expect(await page.evaluate(() => document.getElementById('log-badge').style.display)).toBe('inline-block');
    expect(await page.evaluate(() => document.getElementById('log-badge').textContent)).toBe('1');
  });

  test('"एरर लॉग" खोलने पर बैज छुप जाए और "देखा हुआ" समय अपडेट हो — दोबारा वही पुरानी errors न गिनी जाएं', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      document.getElementById('log-badge').textContent = '3';
      document.getElementById('log-badge').style.display = 'inline-block';
    });
    const beforeSeen = await page.evaluate(() => Number(localStorage.getItem('dc_log_seen_ts')) || 0);
    await page.evaluate(() => openLogModal());
    expect(await page.evaluate(() => document.getElementById('log-badge').style.display)).toBe('none');
    const afterSeen = await page.evaluate(() => Number(localStorage.getItem('dc_log_seen_ts')) || 0);
    expect(afterSeen).toBeGreaterThan(beforeSeen);
  });
});

test.describe('डेटा उपयोग (Firebase Blaze plan) — अनुमानित ट्रेंड ट्रैकिंग', () => {
  test('trackUsageBytes जमा होता है और _usageFlush /USAGE/{महीना} पर POST करके काउंटर रीसेट कर देता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const result = await page.evaluate(() => new Promise((resolve) => {
      trackUsageBytes(500);
      trackUsageBytes(300);
      const orig = window.fetch;
      var posted = null;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && opts && opts.method === 'POST') {
          posted = { url: url, body: JSON.parse(opts.body) };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      _usageFlush();
      setTimeout(() => { window.fetch = orig; resolve({ posted: posted, remaining: _usageBytes }); }, 200);
    }));
    const curMonth = new Date().toISOString().slice(0, 7);
    expect(result.posted.url).toContain('/USAGE/' + curMonth);
    expect(result.posted.body.b).toBe(800);
    expect(result.remaining).toBe(0);
  });

  test('openUsageModal — सिर्फ JE खोल सकते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openUsageModal());
    expect(await page.evaluate(() => document.getElementById('usage-overlay').classList.contains('open'))).toBe(false);
    await expect(page.locator('#toast')).toContainText('सिर्फ JE');
  });

  test('_usageRender — पिछले महीने से 50% से ज़्यादा बढ़ोतरी हो तो चेतावनी दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && (!opts || !opts.method)) {
          var curMonth = new Date().toISOString().slice(0, 7);
          var isCur = url.indexOf('/USAGE/' + curMonth) > -1;
          var data = isCur ? { a: { d: 'dev1', b: 3000000, t: Date.now() } } : { a: { d: 'dev1', b: 1000000, t: Date.now() } };
          return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        }
        return orig(url, opts);
      };
      _usageRender();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    await expect(page.locator('#usage-content')).toContainText('ज़्यादा डेटा इस्तेमाल हुआ');
  });

  test('_usageRender — बढ़ोतरी सामान्य हो तो कोई चेतावनी न दिखे, बस दोनों महीनों का आंकड़ा दिखे', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/USAGE/') > -1 && (!opts || !opts.method)) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ a: { d: 'dev1', b: 2000000, t: Date.now() } }) });
        }
        return orig(url, opts);
      };
      _usageRender();
      setTimeout(() => { window.fetch = orig; resolve(); }, 300);
    }));
    const content = await page.locator('#usage-content').innerText();
    expect(content).not.toContain('असामान्य बढ़ोतरी');
    expect(content).toContain('MB');
  });
});

test.describe('प्रोफ़ाइल — बॉटम नेव, एवतार रंग, फ़ोटो अपलोड', () => {
  test('login के बाद बॉटम नेव के 4 बटन दिखते हैं', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    const labels = await page.locator('.bnav-item .bnav-lbl').allTextContents();
    expect(labels).toEqual(['Home', 'स्कोरकार्ड', 'Profile', 'Support']);
  });

  test('प्रोफ़ाइल मॉडल सही नाम/भूमिका/HQ दिखाता है, बिना फ़ोटो के रंगीन शुरुआती-अक्षर एवतार दिखे', async ({ page }) => {
    await openApp(page);
    await loginLineman(page, 'राधा शर्मा');
    await page.evaluate(() => document.getElementById('update-banner')?.remove());
    await page.click('button[onclick="openProfileModal()"]');
    await expect(page.locator('#profile-name')).toHaveText('राधा शर्मा');
    expect(await page.locator('#profile-meta').textContent()).toContain('लाइनमैन');
    // कोई फ़ोटो नहीं है (server offline) — शुरुआती अक्षर दिखना चाहिए
    await page.waitForTimeout(200);
    expect(await page.locator('#profile-avatar-wrap').textContent()).toBe('र');
  });

  test('सहायता मॉडल JE का ईमेल दिखाता है', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => document.getElementById('update-banner')?.remove());
    await page.click('button[onclick="openSupportModal()"]');
    expect(await page.locator('#support-je-email').textContent()).toContain('@');
  });

  test('फ़ोटो चुनने पर compress होकर PROFILE_PHOTOS पर PUT होती है (आकार छोटा हो)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => document.getElementById('update-banner')?.remove());

    let captured = null;
    await page.route('**/PROFILE_PHOTOS/**', async (route) => {
      captured = route.request().postData();
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.click('button[onclick="openProfileModal()"]');
    // 100x100 का लाल वर्ग वाली छोटी JPEG बनाकर अपलोड करें
    const jpegBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABkAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDk6KKK8I/VgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z',
      'base64'
    );
    await page.setInputFiles('#profile-photo-inp', { name: 'test.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer });
    await page.waitForFunction(() => !!captured, null, { timeout: 8000 }).catch(() => {});
    // Firebase SDK offline में तुरंत उपलब्ध नहीं होता — fetch wrapper 4s बाद raw fetch पर गिरता है
    await page.waitForTimeout(5000);

    expect(captured).toBeTruthy();
    const body = JSON.parse(captured);
    expect(body.photo).toMatch(/^data:image\/jpeg;base64,/);
    const approxBytes = Math.floor(body.photo.split(',')[1].length * 0.75);
    expect(approxBytes).toBeLessThan(60 * 1024); // compressed होने पर बहुत छोटा रहना चाहिए
  });

  test('डार्क मोड टॉगल — html[data-theme] बदलता है, localStorage में याद रहता है, दोबारा खोलने पर बना रहता है', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => openProfileModal());
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(before).not.toBe('dark');
    await page.evaluate(() => toggleTheme());
    const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(after).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('dc_theme'))).toBe('dark');
    await expect(page.locator('#theme-switch-btn')).toHaveClass(/\bon\b/);
    // reload — theme flash न हो, तुरंत dark लागू हो; login session भी बना रहे (pull-to-refresh जैसे
    // असली reload से logout न हो — सिर्फ़ dc_cu session-storage से चुपचाप वापस अंदर आ जाए)
    await page.reload();
    await page.waitForFunction(() => document.getElementById('app-screen').classList.contains('active'), null, { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    // वापस light पर टॉगल करने पर साफ़ हो जाए
    await page.evaluate(() => openProfileModal());
    await page.evaluate(() => toggleTheme());
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('dc_theme'))).toBe('light');
  });
});

test.describe('होम पेज डिस्प्ले बोर्ड — पूरा बोर्ड दिखाने/छुपाने का चुनाव', () => {
  test('renderHomeSc — showBoard:"0" पर home-sc बिल्कुल खाली रहे (login से पहले किसी को कुछ न दिखे)', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => {
      HSC = { curPaid: '10', curAmt: '5', lyPaid: '8', lyAmt: '4', showBoard: '0' };
      renderHomeSc();
    });
    expect(await page.evaluate(() => document.getElementById('home-sc').innerHTML.trim())).toBe('');
  });

  test('renderHomeSc — showBoard न हो (पुराना बोर्ड) या "1" हो तो पहले जैसे दिखता रहे', async ({ page }) => {
    await openApp(page);
    const withoutFlag = await page.evaluate(() => {
      HSC = { curPaid: '10', curAmt: '5', lyPaid: '8', lyAmt: '4' }; // पुराना बोर्ड — showBoard field ही नहीं
      renderHomeSc();
      return document.getElementById('home-sc').innerHTML.length;
    });
    expect(withoutFlag).toBeGreaterThan(0);
    const withFlagOn = await page.evaluate(() => {
      HSC.showBoard = '1';
      renderHomeSc();
      return document.getElementById('home-sc').innerHTML.length;
    });
    expect(withFlagOn).toBeGreaterThan(0);
  });

  test('openHscModal — showBoard checkbox default checked रहे (नया बोर्ड या showBoard missing दोनों में)', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => { HSC = null; });
    await page.evaluate(() => openHscModal());
    expect(await page.locator('#hsc-showboard').isChecked()).toBe(true);
    await page.evaluate(() => closeHscModal());
    await page.evaluate(() => { HSC = { curPaid: '10', curAmt: '5' }; }); // पुराना बोर्ड, showBoard field नहीं
    await page.evaluate(() => openHscModal());
    expect(await page.locator('#hsc-showboard').isChecked()).toBe(true);
  });

  test('saveHsc — showBoard अनचेक करके सेव करें तो publish होने वाले data में showBoard:"0" जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const body = await page.evaluate(() => new Promise((resolve) => {
      const orig = window.fetch;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1 && opts && opts.method === 'PUT') {
          window.fetch = orig;
          resolve(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return orig(url, opts);
      };
      openHscModal();
      document.getElementById('hsc-curpaid').value = '10';
      document.getElementById('hsc-curamt').value = '5';
      document.getElementById('hsc-showboard').checked = false;
      saveHsc();
    }));
    expect(body.showBoard).toBe('0');
  });

  test('_hscRetryPublish — lineman/login-से-पहले वाला device बिना अनुमति PUT न भेजे (bug: pending फ्लैग कभी साफ़ न होना)', async ({ page }) => {
    await openApp(page);
    await loginLineman(page); // lineman के पास होम-बोर्ड लिखने की अनुमति नहीं (Firebase rules)
    const putAttempted = await page.evaluate(() => new Promise((resolve) => {
      HSC = { curPaid: '10', curAmt: '5', ts: Date.now() }; // local, server से नया मानकर
      const orig = window.fetch;
      let putSeen = false;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putSeen = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) }); // server पर कुछ नहीं (या पुराना) — फिर भी PUT न हो
        }
        return orig(url, opts);
      };
      _hscRetryPublish();
      setTimeout(() => { window.fetch = orig; resolve(putSeen); }, 300);
    }));
    expect(putAttempted).toBe(false);
  });

  test('_hscRetryPublish — JE का device सही तरीके से publish कर सके', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    const putAttempted = await page.evaluate(() => new Promise((resolve) => {
      HSC = { curPaid: '10', curAmt: '5', ts: Date.now() };
      const orig = window.fetch;
      let putSeen = false;
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('HOME_SCORECARD') > -1) {
          if (opts && opts.method === 'PUT') { putSeen = true; return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
        }
        return orig(url, opts);
      };
      _hscRetryPublish();
      setTimeout(() => { window.fetch = orig; resolve(putSeen); }, 300);
    }));
    expect(putAttempted).toBe(true);
  });
});

test.describe('फोन-नंबर मॉडल — दो तरह के संदेश (सामान्य रिमाइंडर / विच्छेदन सूचना धारा 56)', () => {
  test('डिफ़ॉल्ट रूप से "सामान्य रिमाइंडर" चुना हो — नाम सहित सही sms/WhatsApp लिंक बने', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPhModal('राम कुमार', '9876543210', 'ACC1', 500));
    const active = await page.evaluate(() => document.querySelector('.ph-mt-btn.active').getAttribute('data-type'));
    expect(active).toBe('reminder');
    const wa = await page.evaluate(() => decodeURIComponent(document.getElementById('ph-wa-btn').href.split('text=')[1]));
    expect(wa).toContain('राम कुमार');
    expect(wa).not.toContain('धारा 56');
  });

  test('"विच्छेदन सूचना" चुनने पर नाम + आदेगांव बिजली वितरण केंद्र सिवनी वाला संदेश बने, और याद रह जाए', async ({ page }) => {
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => openPhModal('सीता बाई', '9876500000', 'ACC2', 3107));
    await page.evaluate(() => _phSelectMsgType('disconnect'));
    const wa = await page.evaluate(() => decodeURIComponent(document.getElementById('ph-wa-btn').href.split('text=')[1]));
    expect(wa).toContain('सीता बाई');
    expect(wa).toContain('धारा 56');
    expect(wa).toContain('आदेगांव बिजली वितरण केंद्र सिवनी');
    expect(wa).not.toContain('MPPKVVCL');
    expect(await page.evaluate(() => localStorage.getItem('dc_ph_msgtype'))).toBe('disconnect');
    // मॉडल दोबारा खोलने पर वही (याद किया हुआ) टाइप चुना हो — पर दूसरा विकल्प भी मौजूद रहे
    await page.evaluate(() => closePhModal());
    await page.evaluate(() => openPhModal('गीता देवी', '9876511111', 'ACC3', 800));
    expect(await page.evaluate(() => document.querySelector('.ph-mt-btn.active').getAttribute('data-type'))).toBe('disconnect');
    expect(await page.evaluate(() => document.querySelectorAll('.ph-mt-btn').length)).toBe(2);
    // वापस "सामान्य रिमाइंडर" पर बदल सकें
    await page.evaluate(() => _phSelectMsgType('reminder'));
    expect(await page.evaluate(() => localStorage.getItem('dc_ph_msgtype'))).toBe('reminder');
  });
});

test.describe('"बाकी/वसूल" filter चुनकर HQ बदलने पर सही रीसेट हो (bug: वसूल entry बाकी में दिखना)', () => {
  test('"बाकी" filter चुनकर दूसरे HQ पर जाने पर filter बटन भी वापस "सभी" दिखे, अंदर से भी activeFilter="all" हो', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.click('[data-f="pending"]');
    await expect(page.locator('[data-f="pending"]')).toHaveClass(/active-pending/);
    await page.evaluate(() => {
      var tabs = document.querySelectorAll('#hq-tabs .hq-tab');
      tabs[1].click(); // कोई दूसरा HQ
    });
    await page.waitForFunction(() => typeof activeFilter !== 'undefined' && activeFilter === 'all');
    expect(await page.evaluate(() => document.querySelector('[data-f="all"]').className)).toContain('active-all');
    expect(await page.evaluate(() => document.querySelector('[data-f="pending"]').className)).toBe('filter-btn');
  });
});

test.describe('कैश लिस्ट — एक ही उपभोक्ता कई categories में हो तो सभी में status मिले', () => {
  test('_applyCashMatched के बाद reconcileHQ से बाकी categories में भी paid status मिल जाए', async ({ page }) => {
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      activeHQ = 'आदेगांव';
      cSet('आदेगांव', 'कुल उपभोक्ता', [{ acc: '1134022288', name: 'टेस्ट उपभोक्ता', status: 'pending', amount: 500 }]);
      cSet('आदेगांव', 'घरेलू', [{ acc: '1134022288', name: 'टेस्ट उपभोक्ता', status: 'pending', amount: 500 }]);
      CASH_IVRS = ['1134022288'];
    });
    await page.evaluate(() => _applyCashMatched(['आदेगांव']));
    const statuses = await page.evaluate(() => ({
      kul: cGet('आदेगांव', 'कुल उपभोक्ता')[0].status,
      ghar: cGet('आदेगांव', 'घरेलू')[0].status,
    }));
    expect(statuses.kul).toBe('paid');
    expect(statuses.ghar).toBe('paid');
  });
});

test.describe('परफ़ॉर्मेंस — बड़ी लिस्ट (कुल उपभोक्ता का असली max 3500 records)', () => {
  test('renderListWith — पूरे 3500 records "और दिखाएं" से पूरे रेंडर करने में उचित समय लगे', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginLineman(page);
    await page.evaluate((hq) => {
      var arr = [];
      for (var i = 0; i < 3500; i++) {
        arr.push({
          acc: '9' + String(i).padStart(9, '0'), name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 40),
          status: i % 3 === 0 ? 'paid' : 'pending', amount: 500 + (i % 50) * 10, phone: '9' + String(1000000000 + i),
          tariff: 'LV1', father: 'पिता ' + i,
        });
      }
      cSet(CU.hq, 'कुल उपभोक्ता', arr);
      activeCat = 'कुल उपभोक्ता';
    }, null);
    const t = await page.evaluate(() => {
      _renderLimit = 3500;
      var start = performance.now();
      renderListWith(cGet(CU.hq, 'कुल उपभोक्ता'));
      return performance.now() - start;
    });
    expect(await page.evaluate(() => document.querySelectorAll('.con-card').length)).toBe(3500);
    expect(t).toBeLessThan(2000); // CI पर असल में ~200ms लगता है — 10x मार्जिन, फिर भी भविष्य में कोई O(n²)-जैसी गड़बड़ी आने पर पकड़ लेगा
  });

  test('renderListWith — 3500 records में search/filter उचित समय में हो', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginLineman(page);
    await page.evaluate(() => {
      var arr = [];
      for (var i = 0; i < 3500; i++) {
        arr.push({ acc: '9' + String(i).padStart(9, '0'), name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 40), status: i % 3 === 0 ? 'paid' : 'pending', amount: 500 });
      }
      cSet(CU.hq, 'कुल उपभोक्ता', arr);
      activeCat = 'कुल उपभोक्ता';
      document.getElementById('search-inp').value = 'उपभोक्ता 34';
    });
    const t = await page.evaluate(() => {
      var start = performance.now();
      renderList();
      return performance.now() - start;
    });
    expect(t).toBeLessThan(1000);
  });

  test('_vgComputeRows — एक HQ के सभी categories मिलाकर गांव-वार जोड़ने में उचित समय लगे', async ({ page }) => {
    test.setTimeout(60000);
    await openApp(page);
    await loginJE(page);
    await page.evaluate(() => {
      var cats = ['कुल उपभोक्ता', 'घरेलू', 'व्यवसाय', 'कृषि'];
      cats.forEach(function (cat) {
        var arr = [];
        for (var i = 0; i < 1000; i++) {
          arr.push({ acc: cat + '_' + i, name: 'उपभोक्ता ' + i, addr: 'गांव ' + (i % 50), status: i % 2 === 0 ? 'paid' : 'pending', amount: 500 });
        }
        cSet('आदेगांव', cat, arr);
      });
    });
    const t = await page.evaluate(() => {
      var start = performance.now();
      _vgComputeRows('आदेगांव');
      return performance.now() - start;
    });
    expect(t).toBeLessThan(2000);
  });
});
