// वसूली ट्रैकर — कोई build step/framework नहीं, सभी js/*.js फाइलें एक ही global scope
// शेयर करती हैं (index.html में एक-एक करके <script> से लोड होती हैं) और ज़्यादातर टॉप-लेवल
// function index.html के inline onclick="" से बुलाए जाते हैं — इसलिए no-unused-vars सिर्फ़
// function के अंदर वाले local variables पर लागू है, टॉप-लेवल पर नहीं।
const js = require("@eslint/js");
const globals = require("globals");

// js/*.js में परिभाषित सभी टॉप-लेवल var/function — बाकी फाइलों में इस्तेमाल होते हैं
const sharedGlobals = require("./eslint.shared-globals.json");

module.exports = [
  js.configs.recommended,
  {
    files: ["eslint.config.js"],
    languageOptions: { sourceType: "commonjs", ecmaVersion: 2021, globals: { ...globals.node } },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: {
      sourceType: "script",
      ecmaVersion: 2021,
      globals: {
        ...globals.browser,
        ...Object.fromEntries(sharedGlobals.map((g) => [g, "writable"])),
        XLSX: "readonly",
        Papa: "readonly",
        firebase: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-misleading-character-class": "off", // ऀ-ॿ जैसी Devanagari Unicode range जान-बूझकर है
      // हर global यहीं परिभाषित भी होता है — ESLint को हर definition site पर "redeclare"
      // जैसा लगता है, जबकि यह इस no-build-step, multi-file shared-namespace architecture
      // का सामान्य पैटर्न है, कोई असली बग नहीं
      "no-redeclare": "off",
    },
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2021,
      globals: { ...globals.node },
    },
    rules: {
      "no-useless-escape": "off",
    },
  },
  {
    // page.evaluate(() => {...}) के अंदर browser-context कोड भी इसी फाइल में है, जो app के
    // global variables/functions इस्तेमाल करता है — इसलिए वही sharedGlobals यहां भी चाहिए
    files: ["tests/**/*.js", "playwright.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2021,
      globals: {
        ...globals.node,
        ...globals.browser,
        ...Object.fromEntries(sharedGlobals.map((g) => [g, "writable"])),
        XLSX: "writable",
        Papa: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-redeclare": "off",
    },
  },
];
