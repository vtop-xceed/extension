/**
 * Shared constants for the VTOP++ Captcha Solver extension.
 * Loaded before background.js (via importScripts) and popup.js/content.js.
 */

const VTOPPP_DEFAULTS = {
  endpoints: {
    duckdns: "https://captop.duckdns.org",
    proxy: "https://captop-proxy.sykik.workers.dev",
  },
  reportDefault: true,
};

/**
 * Keys for sessionStorage (survives page reloads on failed submit)
 */
const VTOPPP_STORAGE_KEY_CAPTCHA = "vtop_captcha_base64";
const VTOPPP_STORAGE_KEY_PREDICTION = "vtop_captcha_prediction";
