/**
 * Popup script - save/load API endpoint configuration and report consent.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const apiInput = document.getElementById("apiUrl");
  const saveBtn = document.getElementById("saveBtn");
  const customContainer = document.getElementById("custom-url-container");
  const radioDuckdns = document.getElementById("ep-duckdns");
  const radioProxy = document.getElementById("ep-proxy");
  const radioCustom = document.getElementById("ep-custom");
  const reportToggle = document.getElementById("reportOptIn");

  const statusDuckdns = document.getElementById("status-duckdns");
  const statusProxy = document.getElementById("status-proxy");

  const DEFAULT_DUCKDNS = VTOPPP_DEFAULTS.endpoints.duckdns;
  const DEFAULT_PROXY = VTOPPP_DEFAULTS.endpoints.proxy;

  // Load saved settings
  const stored = await chrome.storage.sync.get(["apiUrl", "reportOptIn"]);
  const currentUrl = stored.apiUrl || DEFAULT_PROXY;
  reportToggle.checked = stored.reportOptIn !== false;

  if (currentUrl === DEFAULT_DUCKDNS) {
    radioDuckdns.checked = true;
  } else if (currentUrl === DEFAULT_PROXY) {
    radioProxy.checked = true;
  } else {
    radioCustom.checked = true;
    customContainer.style.display = "block";
    apiInput.value = currentUrl;
  }

  reportToggle.addEventListener("change", async () => {
    await chrome.storage.sync.set({ reportOptIn: reportToggle.checked });
  });

  // Toggle custom input and save on change for predefined ones
  [radioDuckdns, radioProxy, radioCustom].forEach((radio) => {
    radio.addEventListener("change", async () => {
      customContainer.style.display = radioCustom.checked ? "block" : "none";

      if (!radioCustom.checked) {
        const url = radio.value;
        await chrome.storage.sync.set({ apiUrl: url });
        console.log("API URL updated on the fly:", url);
      }
    });
  });

  // Save settings (mainly for custom URL)
  saveBtn.addEventListener("click", async () => {
    let url;
    if (radioDuckdns.checked) url = DEFAULT_DUCKDNS;
    else if (radioProxy.checked) url = DEFAULT_PROXY;
    else url = apiInput.value.trim() || DEFAULT_PROXY;

    await chrome.storage.sync.set({ apiUrl: url, reportOptIn: reportToggle.checked });

    saveBtn.textContent = "Saved!";
    setTimeout(() => {
      saveBtn.textContent = "Save Settings";
    }, 1500);
  });

  // Check statuses with a slight delay for better feel
  setTimeout(() => {
    checkStatus(DEFAULT_DUCKDNS, statusDuckdns);
    checkStatus(DEFAULT_PROXY, statusProxy);
  }, 100);
});

async function checkStatus(url, element) {
  try {
    const response = await fetch(`${url}/health`, {
      method: "GET",
      mode: "cors",
    });
    if (response.ok) {
      element.classList.add("status-online");
    } else {
      element.classList.add("status-offline");
    }
  } catch {
    element.classList.add("status-offline");
  }
}
