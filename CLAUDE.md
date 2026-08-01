# वसूली ट्रैकर (Recovery Tracker)

आदेगांव Distribution Centre / लखनादौन डिवीजन सिवनी सर्कल (मध्य प्रदेश बिजली विभाग) के लिए एक ऑफ़लाइन-फर्स्ट PWA — vanilla JavaScript, कोई framework नहीं।

## Tech Stack
- Vanilla JavaScript (कोई build step नहीं)
- Firebase Realtime Database + Firebase Auth + Firebase App Check
- Netlify पर डिप्लॉय (साइट: adegaondc)
- Playwright से टेस्ट

## Repo/Branch
- GitHub: `pradeepks2015-ship-it/ADEGAON`
- `main` branch से Netlify auto-deploy होता है
- सारा development branch `claude/app-version-strengths-weaknesses-v19hwv` पर होता है, फिर PR बनाकर `main` में merge होता है

## मुख्य फाइलें
- `js/config.js` — HQS, CATS, APP_VER, HQ_AUTH_EMAIL, JE_EMAIL, CAT_NAMES
- `js/firebase.js` — Firebase config, auth token handling
- `js/ui-core.js` — login/logout/UI core, doLogout, goBack
- `js/list.js` — कंज्यूमर लिस्ट render + filter + status (renderListWith, markPaid, propagateStatus)
- `js/database.js` — fbGet, normList, startListen
- `js/village.js` — गांव-वार वसूली + VILLAGE_ALIASES (आदेगांव-विशिष्ट गांव-नाम स्पेलिंग सुधार)
- `js/home-scorecard.js` — होम पेज डिस्प्ले बोर्ड + कैश लिस्ट (bulk cash-payment upload)
- `js/reports.js` — फोन एक्शन मॉडल (SMS/WhatsApp templates), स्कोरकार्ड, PDF/Excel, service-worker registration
- `js/migration.js` — पुराने array-format से नए per-record object-format में माइग्रेशन
- `js/profile.js`, `js/upload.js`
- `index.html`, `css/style.css`
- `sw.js` — service worker + CACHE_NAME
- `tests/smoke.spec.js` — पूरा टेस्ट suite
- `database.rules.json` — Firebase Realtime Database की Security Rules (version-controlled कॉपी; असली/लाइव rules Firebase Console → Realtime Database → Rules में हैं)
- `eslint.config.js` / `eslint.shared-globals.json` — CI लिंट सेटअप; कोई नई top-level global var/function (जो दूसरी js/*.js फाइल में इस्तेमाल हो) जोड़ें तो `node scripts/gen-eslint-globals.js` चलाकर globals list दोबारा बनाएं

## काम शुरू करने से पहले
`git log --oneline -20` और हाल के merged PRs देख लें — पूरा इतिहास (फ़ैसले, bug root-causes, fixes) commit messages और PR descriptions में दर्ज है।

## हर बदलाव के लिए तय प्रक्रिया (सख़्ती से पालन करें)
1. कोई भी asset/behavior बदलाव करने पर `js/config.js` का `APP_VER` और `sw.js` का `CACHE_NAME` दोनों एक-साथ बढ़ाएं (जैसे 9.65→9.66, v82→v83)।
2. बदलाव के बाद पूरा Playwright suite पास होना ज़रूरी है:
   ```
   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
   ```
   (local dev server: `python3 -m http.server 8080 --directory <repo-path>`)
   साथ ही `npm run lint` भी साफ़ (0 errors) होना चाहिए।
3. Commit → `git fetch origin main` करके rebase करें (पिछले squash-merge से conflict बचाने के लिए) → push → PR बनाएं → PR की "smoke" **और** "lint" दोनों CI checks पास होने का इंतज़ार करें → तभी merge करें (squash) → PR activity से unsubscribe करें।
4. बड़े visual/UI बदलाव हों तो पहले screenshot लेकर दिखाएं, अनुमति के बाद ही merge करें।
5. कभी भी बिना पूछे risky/destructive git ऑपरेशन (force push to main, reset --hard, आदि) न करें।
6. Firebase Security Rules में कोई बदलाव करना हो तो पहले `database.rules.json` में बदलें, commit/PR/merge की सामान्य प्रक्रिया से गुज़ारें, और merge के बाद **JE (उपयोगकर्ता) को Firebase Console → Realtime Database → Rules में जाकर वही बदलाव मैन्युअली paste/publish करने को कहें** — इस रेपो से rules अपने-आप deploy नहीं होतीं, यह फाइल सिर्फ़ version-history/backup के लिए है (कोई automated deploy pipeline अभी नहीं है)।

## भाषा
उपयोगकर्ता (JE) से हमेशा हिंदी में बात करें — कोड कमेंट भी हिंदी में लिखे जाते हैं (established convention)।

## किसी अन्य Distribution Centre के लिए यह ऐप दोबारा बनानी हो तो
सिर्फ़ यही बदलना पड़ेगा (कोई feature/logic नहीं बदलता): नया Firebase प्रोजेक्ट (DB + Auth + App Check), `js/config.js` का HQS/HQ_AUTH_EMAIL/JE_EMAIL, `js/firebase.js` का पूरा config, `scripts/backup.js` की अलग HQS/DB_URL, `js/village.js` का VILLAGE_ALIASES (खाली करके नए सिरे से), `index.html` का `#hq-sel` dropdown (hardcoded options), `database.rules.json`/`.firebaserc` (नए project-id और हर HQ के नए Firebase Auth UID के साथ दोबारा बनाना), और सभी जगह ब्रांडिंग टेक्स्ट ("आदेगांव"/"सिवनी"/"लखनादौन")।
