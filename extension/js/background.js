/**
 * VTOP Captcha Solver - Background Script
 * Handles network requests to bypass Content Security Policy (CSP) of the host page.
 */

if (typeof importScripts === "function") {
  importScripts("js/constants.js");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "solve") {
    handleSolve(request.image).then(sendResponse);
    return true;
  } else if (request.action === "report") {
    handleReport(request.image, request.prediction).then(sendResponse);
    return true;
  } else if (request.action === "badge-warn") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    sendResponse({ success: true });
  } else if (request.action === "badge-clear") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ success: true });
  }
});

async function isReportingEnabled() {
  const stored = await chrome.storage.sync.get(["reportOptIn"]);
  return stored.reportOptIn !== false;
}

async function handleSolve(image) {
  try {
    const apiUrl = await getApiUrl();
    const response = await fetch(`${apiUrl}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });

    if (!response.ok) throw new Error("API error");
    const data = await response.json();
    return { success: true, text: data.text };
  } catch (error) {
    console.error("[Background] Solve error:", error);
    return { success: false, error: error.message };
  }
}

async function handleReport(image, prediction) {
  try {
    if (!(await isReportingEnabled())) {
      return { success: true, skipped: true };
    }
    const apiUrl = await getApiUrl();
    await fetch(`${apiUrl}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, prediction, source: "extension" }),
    });
    return { success: true };
  } catch (error) {
    console.error("[Background] Report error:", error);
    return { success: false, error: error.message };
  }
}

async function getApiUrl() {
  const stored = await chrome.storage.sync.get(["apiUrl"]);
  return stored.apiUrl || VTOPPP_DEFAULTS.endpoints.proxy;
}
