/**
 * VTOP Captcha Solver - Content Script
 * Automatically detects and solves captchas on the login page.
 */


// Track current captcha state
let currentCaptchaBase64 = null;
let currentPrediction = null;

// Keys for sessionStorage
const STORAGE_KEY_CAPTCHA = 'vtop_captcha_base64';
const STORAGE_KEY_PREDICTION = 'vtop_captcha_prediction';

const INIT_ATTEMPT_LIMIT = 10;
let initAttempts = 0;
let badgeWarned = false;

function notifyBadgeWarn() {
  if (badgeWarned) return;
  badgeWarned = true;
  chrome.runtime.sendMessage({ action: 'badge-warn' }, () => chrome.runtime.lastError);
}

/**
 * Initialize the solver when the page loads
 */
async function init() {

  // Check if we just reloaded from a failed login attempt
  const savedCaptcha = sessionStorage.getItem(STORAGE_KEY_CAPTCHA);
  const savedPrediction = sessionStorage.getItem(STORAGE_KEY_PREDICTION);

  if (savedCaptcha && savedPrediction) {
    // Look for error text in the body immediately on load
    // We use innerText to capture rendered text, as VTOP may have multiple nested elements.
    const bodyText = document.body.innerText?.toLowerCase() || '';
    if (bodyText.includes('invalid') || bodyText.includes('wrong')) {
      console.log('[CaptchaSolver] Detected error on page load, reporting saved captcha...');
      currentCaptchaBase64 = savedCaptcha;
      currentPrediction = savedPrediction;
      await reportFailure();
    } else {
      // Clear storage if login was successful or navigated away
      sessionStorage.removeItem(STORAGE_KEY_CAPTCHA);
      sessionStorage.removeItem(STORAGE_KEY_PREDICTION);
    }
  }

  const captchaImg = document.querySelector('#captchaBlock img');
  const captchaInput = document.getElementById('captchaStr');

  if (!captchaImg || !captchaInput) {
    initAttempts += 1;
    console.log('[CaptchaSolver] Login form not found, retrying...');
    if (initAttempts >= INIT_ATTEMPT_LIMIT) {
      notifyBadgeWarn();
    }
    setTimeout(init, 500);
    return;
  }

  console.log('[CaptchaSolver] Initialized');

  // Solve on initial load
  solveCaptcha();

  // Watch for captcha refresh
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        solveCaptcha();
      }
    }
  });

  observer.observe(captchaImg, { attributes: true });

  // Watch for login failure to report
  watchLoginResult();
}

/**
 * Main solve function
 */
async function solveCaptcha() {
  const captchaImg = document.querySelector('#captchaBlock img');
  const captchaInput = document.getElementById('captchaStr');

  if (!captchaImg || !captchaInput) return;

  // Extract base64 from src (remove data:image/jpeg;base64, prefix)
  const src = captchaImg.src;
  if (!src.startsWith('data:image')) {
    console.log('[CaptchaSolver] Invalid captcha src');
    return;
  }

  currentCaptchaBase64 = src.split(',')[1];

  // Show loading bar
  showLoadingBar(captchaInput);

  try {
    // Send to background script to bypass CSP
    chrome.runtime.sendMessage({
      action: 'solve',
      image: currentCaptchaBase64
    }, (response) => {
      if (!response || !response.success) {
        throw new Error(response?.error || 'Background script error');
      }

      currentPrediction = response.text;
      
      // Save to sessionStorage to survive page reloads on bad submit
      sessionStorage.setItem(STORAGE_KEY_CAPTCHA, currentCaptchaBase64);
      sessionStorage.setItem(STORAGE_KEY_PREDICTION, response.text);

      hideLoadingBar(captchaInput, response.text);
      console.log(`[CaptchaSolver] Solved: ${response.text}`);
      if (badgeWarned) {
        chrome.runtime.sendMessage({ action: 'badge-clear' }, () => chrome.runtime.lastError);
        badgeWarned = false;
        initAttempts = 0;
      }
    });

  } catch (error) {
    console.error('[CaptchaSolver] Solve Error:', error);
    hideLoadingBar(captchaInput, '');
  }
}

/**
 * Replace input with Windows 7-style loading bar
 */
function showLoadingBar(input) {
  input.value = '';
  input.placeholder = '';
  input.classList.add('vtop-loading');
  input.readOnly = true;
}

/**
 * Restore input and fill with solved text
 */
function hideLoadingBar(input, text) {
  input.classList.remove('vtop-loading');
  input.classList.add('vtop-solved');
  input.readOnly = false;
  input.value = text;

  // Remove solved class after animation
  setTimeout(() => {
    input.classList.remove('vtop-solved');
  }, 500);
}

/**
 * Watch for login failures to report bad predictions
 */
function watchLoginResult() {
  // Watch for error messages appearing
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const text = node.textContent?.toLowerCase() || '';
          if (text.includes('invalid') || text.includes('wrong')) {
            reportFailure();
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Report failed captcha to server for retraining
 */
async function reportFailure() {
  if (!currentCaptchaBase64 || !currentPrediction) return;

  console.log('[CaptchaSolver] Reporting failed prediction');

  try {
    chrome.runtime.sendMessage({
      action: 'report',
      image: currentCaptchaBase64,
      prediction: currentPrediction
    });
  } catch (error) {
    console.error('[CaptchaSolver] Report error:', error);
  }

  // Clear to prevent duplicate reports
  currentCaptchaBase64 = null;
  currentPrediction = null;
  sessionStorage.removeItem(STORAGE_KEY_CAPTCHA);
  sessionStorage.removeItem(STORAGE_KEY_PREDICTION);
}

// Start
init();
