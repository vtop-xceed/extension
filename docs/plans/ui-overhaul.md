# VTOP++ UI Overhaul (folded plan)

> Originally written as `IMPLEMENTATION_PLAN.md` at workspace root.
> Folded into `extension` in 2026: the chrome extension that ships the
> captcha solver first, and this overhaul as an opt-in milestone behind it.

# VTOP++ Chrome Extension — Implementation Plan

> A Manifest V3 Chrome extension that transforms the VTOP student portal into a modern, dark-themed, mobile-friendly experience with auto-loaded dashboard data and intuitive navigation.

---

## Table of Contents
1. [Project Structure](#1-project-structure)
2. [Milestone 1: Scaffolding & Core Infrastructure](#2-milestone-1-scaffolding--core-infrastructure)
3. [Milestone 2: Dark Mode & Theming](#3-milestone-2-dark-mode--theming)
4. [Milestone 3: Auto-Load Dashboard](#4-milestone-3-auto-load-dashboard)
5. [Milestone 4: Navigation Overhaul](#5-milestone-4-navigation-overhaul)
6. [Milestone 5: Mobile Support](#6-milestone-5-mobile-support)
7. [Milestone 6: Caching & Performance](#7-milestone-6-caching--performance)
8. [VTOP Technical Reference](#8-vtop-technical-reference)
9. [Verification Plan](#9-verification-plan)

---

## 1. Project Structure

All code lives in `/home/sykik/Dev/vtop++/`. Create this exact file tree:

```
vtop++/
├── manifest.json              # Extension manifest (V3)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── content/
│   ├── main.js                # Entry point — orchestrates all modules
│   ├── vtop-api.js            # Talks to VTOP endpoints
│   ├── dom-observer.js        # Watches #b3wrapper for page changes
│   ├── page-detector.js       # Identifies which VTOP page is loaded
│   ├── dashboard-builder.js   # Builds the custom auto-loaded dashboard
│   └── nav-builder.js         # Builds the replacement navigation UI
├── styles/
│   ├── reset.css              # Hides/overrides original VTOP styles
│   ├── theme.css              # CSS custom properties for dark/light themes
│   ├── dashboard.css          # Dashboard layout styles
│   ├── nav.css                # New navigation bar styles
│   └── responsive.css         # Mobile breakpoints
├── popup/
│   ├── popup.html             # Extension popup (theme picker, settings)
│   ├── popup.css
│   └── popup.js
├── background/
│   └── service-worker.js      # Manifest V3 background script
└── fonts/
    ├── Inter-Regular.woff2
    ├── Inter-Medium.woff2
    └── Inter-SemiBold.woff2
```

---

## 2. Milestone 1: Scaffolding & Core Infrastructure

### Step 1.1: Create `manifest.json`

Create file: `/home/sykik/Dev/vtop++/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "VTOP++",
  "version": "0.1.0",
  "description": "A modern UI overhaul for VIT Bhopal's VTOP portal",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://vtop.vitbhopal.ac.in/*"],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["https://vtop.vitbhopal.ac.in/vtop/*"],
      "css": [
        "styles/reset.css",
        "styles/theme.css",
        "styles/dashboard.css",
        "styles/nav.css",
        "styles/responsive.css"
      ],
      "js": [
        "content/vtop-api.js",
        "content/page-detector.js",
        "content/dom-observer.js",
        "content/dashboard-builder.js",
        "content/nav-builder.js",
        "content/main.js"
      ],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "web_accessible_resources": [
    {
      "resources": ["fonts/*", "icons/*"],
      "matches": ["https://vtop.vitbhopal.ac.in/*"]
    }
  ]
}
```

**Why `run_at: document_idle`**: VTOP loads its inline scripts (with `csrfValue` and `id`) during parsing. By running at idle, we guarantee those globals exist when our code runs.

---

### Step 1.2: Create `content/vtop-api.js`

This module reads VTOP's global variables and makes authenticated requests. Every other module depends on this.

```javascript
// content/vtop-api.js
// Provides authenticated access to VTOP endpoints.
// VTOP stores auth data in global JS variables set during page load.

const VtopAPI = (() => {
  const cache = {};
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Reads the CSRF token from the page's global scope.
   * VTOP sets: var csrfValue = "xxxxx";
   * @returns {string|null}
   */
  function getCsrf() {
    // Try the global variable first
    if (typeof csrfValue !== 'undefined') return csrfValue;
    // Fallback: look for hidden input
    const input = document.querySelector('input[name="_csrf"]');
    return input ? input.value : null;
  }

  /**
   * Reads the student registration number.
   * VTOP sets: var id = "24BCY10147";
   * @returns {string|null}
   */
  function getStudentId() {
    if (typeof id !== 'undefined' && id) return id;
    if (typeof window.authorizedID !== 'undefined') return window.authorizedID;
    return null;
  }

  /**
   * Returns the standard POST body that VTOP expects on every request.
   * @param {Object} extra - Additional key-value pairs to include
   * @returns {string} URL-encoded form body
   */
  function buildBody(extra = {}) {
    const csrf = getCsrf();
    const studentId = getStudentId();
    if (!csrf || !studentId) {
      console.error('[VTOP++] Cannot build request body: missing csrf or studentId');
      return null;
    }
    const params = new URLSearchParams({
      _csrf: csrf,
      authorizedID: studentId,
      x: new Date().toUTCString(),
      ...extra
    });
    return params.toString();
  }

  /**
   * Makes an authenticated POST request to a VTOP endpoint.
   * @param {string} endpoint - Relative path, e.g. "/vtop/processViewTimeTable"
   * @param {Object} extraParams - Additional form parameters
   * @returns {Promise<string>} The HTML response text
   */
  async function post(endpoint, extraParams = {}) {
    const body = buildBody(extraParams);
    if (!body) throw new Error('Auth data not available');

    const url = endpoint.startsWith('/') ? endpoint : '/vtop/' + endpoint;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: body
    });

    if (!response.ok) throw new Error(`VTOP request failed: ${response.status}`);
    return response.text();
  }

  /**
   * Cached version of post(). Returns cached HTML if available and fresh.
   */
  async function cachedPost(endpoint, extraParams = {}) {
    const key = endpoint + JSON.stringify(extraParams);
    const cached = cache[key];
    if (cached && (Date.now() - cached.time) < CACHE_TTL) {
      console.log('[VTOP++] Cache hit:', endpoint);
      return cached.data;
    }
    const data = await post(endpoint, extraParams);
    cache[key] = { data, time: Date.now() };
    return data;
  }

  /**
   * Checks if we are logged in by verifying global auth vars exist.
   * @returns {boolean}
   */
  function isLoggedIn() {
    return !!(getCsrf() && getStudentId());
  }

  return { getCsrf, getStudentId, buildBody, post, cachedPost, isLoggedIn };
})();
```

---

### Step 1.3: Create `content/page-detector.js`

Identifies which VTOP page is currently loaded by inspecting DOM content.

```javascript
// content/page-detector.js
// Detects which VTOP page is currently displayed in #b3wrapper.

const PageDetector = (() => {
  const PAGE_SIGNATURES = {
    'dashboard': () => !!document.querySelector('.CurrentSemesterCourseDetails'),
    'attendance': () => {
      const h = document.querySelector('#b3wrapper h4, #b3wrapper h3');
      return h && h.textContent.includes('Attendance');
    },
    'timetable': () => {
      const h = document.querySelector('#b3wrapper h4, #b3wrapper h3');
      return h && h.textContent.includes('Time Table');
    },
    'marks': () => {
      const h = document.querySelector('#b3wrapper h4, #b3wrapper h3');
      return h && h.textContent.includes('Mark');
    },
    'grades': () => {
      const h = document.querySelector('#b3wrapper h4, #b3wrapper h3');
      return h && h.textContent.includes('Grade');
    },
    'exam-schedule': () => {
      const h = document.querySelector('#b3wrapper h4, #b3wrapper h3');
      return h && h.textContent.includes('Exam Schedule');
    },
    'login': () => !!document.querySelector('#loginForm, .box-title.text-center')
  };

  function detect() {
    for (const [name, test] of Object.entries(PAGE_SIGNATURES)) {
      try { if (test()) return name; } catch (e) { /* skip */ }
    }
    return 'unknown';
  }

  return { detect };
})();
```

---

### Step 1.4: Create `content/dom-observer.js`

Watches the main content container for changes (VTOP injects new HTML via AJAX).

```javascript
// content/dom-observer.js
// Watches VTOP's content containers for DOM changes and fires callbacks.

const DomObserver = (() => {
  const listeners = [];
  let observer = null;

  function onPageChange(callback) {
    listeners.push(callback);
  }

  function start() {
    const targets = ['#b3wrapper', '#b5wrapper', '#core-container'];
    let targetEl = null;
    for (const sel of targets) {
      targetEl = document.querySelector(sel);
      if (targetEl) break;
    }

    if (!targetEl) {
      console.warn('[VTOP++] No content container found. Retrying in 1s...');
      setTimeout(start, 1000);
      return;
    }

    let debounceTimer = null;
    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const page = PageDetector.detect();
        console.log(`[VTOP++] Page changed → ${page}`);
        listeners.forEach(cb => cb(page));
      }, 150);
    });

    observer.observe(targetEl, { childList: true, subtree: true });
    console.log('[VTOP++] DomObserver started on', targetEl.id || targetEl.className);
  }

  return { onPageChange, start };
})();
```

---

### Step 1.5: Create `content/dashboard-builder.js`

Fetches attendance, timetable, and CGPA data on login and renders a custom dashboard.

```javascript
// content/dashboard-builder.js
// Builds a custom auto-loaded dashboard replacing the default VTOP home.

const DashboardBuilder = (() => {
  const CURRENT_SEMESTER = 'BL20252605';

  async function fetchAll() {
    const [attendance, timetable, cgpa, courses] = await Promise.allSettled([
      VtopAPI.cachedPost('/vtop/processViewStudentAttendance', { semesterSubId: CURRENT_SEMESTER }),
      VtopAPI.cachedPost('/vtop/processViewTimeTable', { semesterSubId: CURRENT_SEMESTER }),
      VtopAPI.cachedPost('/vtop/get/dashboard/current/cgpa/credits'),
      VtopAPI.cachedPost('/vtop/get/dashboard/current/semester/course/details')
    ]);
    return {
      attendance: attendance.status === 'fulfilled' ? attendance.value : null,
      timetable: timetable.status === 'fulfilled' ? timetable.value : null,
      cgpa: cgpa.status === 'fulfilled' ? cgpa.value : null,
      courses: courses.status === 'fulfilled' ? courses.value : null
    };
  }

  function parseHTML(htmlString) {
    const template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    return template.content;
  }

  function parseAttendance(html) {
    if (!html) return [];
    const doc = parseHTML(html);
    const rows = doc.querySelectorAll('table tbody tr');
    const data = [];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 6) {
        data.push({
          course: cells[1]?.textContent?.trim() || '',
          type: cells[2]?.textContent?.trim() || '',
          attended: parseInt(cells[3]?.textContent) || 0,
          total: parseInt(cells[4]?.textContent) || 0,
          percent: parseFloat(cells[5]?.textContent) || 0
        });
      }
    });
    return data;
  }

  async function build() {
    const container = document.querySelector('#b3wrapper') || document.querySelector('#core-container');
    if (!container) return;

    // Show loading state
    container.innerHTML = `
      <div class="vpp-dashboard-loading" style="
        display:flex; align-items:center; justify-content:center;
        min-height:60vh; color:var(--vpp-text-secondary);
        font-size:18px; gap:12px;
      ">
        <div class="vpp-spinner"></div>
        Loading your dashboard...
      </div>
    `;

    try {
      const data = await fetchAll();
      const attendanceData = parseAttendance(data.attendance);

      let attendanceCards = '';
      attendanceData.forEach(a => {
        const color = a.percent >= 90 ? 'var(--vpp-success)'
                    : a.percent >= 75 ? 'var(--vpp-warning)'
                    : 'var(--vpp-danger)';
        attendanceCards += `
          <div class="vpp-card vpp-attendance-card">
            <div class="vpp-card-header">
              <span class="vpp-course-code">${a.course}</span>
              <span class="vpp-course-type">${a.type}</span>
            </div>
            <div class="vpp-attendance-bar-container">
              <div class="vpp-attendance-bar" style="width:${a.percent}%; background:${color}"></div>
            </div>
            <div class="vpp-card-footer">
              <span>${a.attended}/${a.total} classes</span>
              <span class="vpp-attendance-pct" style="color:${color}">${a.percent}%</span>
            </div>
          </div>
        `;
      });

      container.innerHTML = `
        <div class="vpp-dashboard">
          <h2 class="vpp-section-title">Attendance</h2>
          <div class="vpp-card-grid">
            ${attendanceCards || '<p style="color:var(--vpp-text-muted)">No attendance data available</p>'}
          </div>
          <h2 class="vpp-section-title" style="margin-top:32px;">Timetable</h2>
          <div class="vpp-timetable-container">
            ${data.timetable || '<p style="color:var(--vpp-text-muted)">No timetable data available</p>'}
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[VTOP++] Dashboard build failed:', err);
      container.innerHTML = `<div style="padding:40px;color:var(--vpp-danger);">
        Failed to load dashboard. Try refreshing. Error: ${err.message}</div>`;
    }
  }

  return { build, fetchAll, parseAttendance };
})();
```

---

### Step 1.6: Create `content/nav-builder.js`

Hides the sidebar and builds a centered top navigation bar.

```javascript
// content/nav-builder.js
// Replaces the VTOP sidebar with a modern centered top navigation.

const NavBuilder = (() => {
  const NAV_ITEMS = [
    { label: 'Dashboard', icon: '🏠', action: 'home' },
    { label: 'Attendance', icon: '📊', dataUrl: 'academics/common/StudentAttendance' },
    { label: 'Timetable', icon: '📅', dataUrl: 'academics/common/StudentTimeTable' },
    { label: 'Marks', icon: '📝', dataUrl: 'examinations/StudentMarkView' },
    { label: 'Grades', icon: '🎓', dataUrl: 'examinations/examGradeView/StudentGradeView' },
    { label: 'Exams', icon: '📋', dataUrl: 'examinations/StudExamSchedule' },
  ];

  const MORE_ITEMS = [
    { label: 'Faculty Info', dataUrl: 'academics/common/FacultyInfo' },
    { label: 'My Curriculum', dataUrl: 'academics/common/MyCurriculum' },
    { label: 'Course Page', dataUrl: 'academics/common/CoursePage' },
    { label: 'Grade History', dataUrl: 'examinations/GradeHistory' },
    { label: 'Profile', dataUrl: 'myinfo/Profile' },
    { label: 'Hostel Leave', dataUrl: 'hostels/LeaveRequest' },
  ];

  function navigateTo(dataUrl) {
    const body = VtopAPI.buildBody();
    if (!body) return;
    const wrapper = document.querySelector('#b3wrapper') || document.querySelector('#core-container');
    if (!wrapper) return;

    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
      min-height:40vh;color:var(--vpp-text-secondary);gap:8px;">
      <div class="vpp-spinner"></div> Loading...</div>`;

    fetch('/vtop/' + dataUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'same-origin',
      body: body
    })
    .then(r => r.text())
    .then(html => { wrapper.innerHTML = html; })
    .catch(err => {
      wrapper.innerHTML = `<div style="padding:40px;color:var(--vpp-danger);">
        Failed to load page: ${err.message}</div>`;
    });
  }

  function init() {
    // Hide original sidebar
    const sidebar = document.querySelector('#sidebar, .sidebar, .left-sidebar, [class*="sidebar"]');
    if (sidebar) sidebar.style.display = 'none';
    const content = document.querySelector('#core-container, .content-wrapper, #page-wrapper');
    if (content) content.style.marginLeft = '0';

    // Build the nav bar
    const nav = document.createElement('div');
    nav.id = 'vpp-nav';
    nav.innerHTML = `
      <div class="vpp-nav-inner">
        <div class="vpp-nav-brand">VTOP<span class="vpp-nav-plus">++</span></div>
        <div class="vpp-nav-items">
          ${NAV_ITEMS.map(item => `
            <button class="vpp-nav-btn" data-url="${item.dataUrl || ''}" data-action="${item.action || ''}">
              <span class="vpp-nav-icon">${item.icon}</span>
              <span class="vpp-nav-label">${item.label}</span>
            </button>
          `).join('')}
          <div class="vpp-nav-more">
            <button class="vpp-nav-btn vpp-nav-more-btn">
              <span class="vpp-nav-icon">⋯</span>
              <span class="vpp-nav-label">More</span>
            </button>
            <div class="vpp-nav-dropdown">
              ${MORE_ITEMS.map(item => `
                <button class="vpp-nav-dropdown-item" data-url="${item.dataUrl}">
                  ${item.label}
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    const topNav = document.querySelector('.navbar') || document.querySelector('nav');
    if (topNav) topNav.parentNode.insertBefore(nav, topNav.nextSibling);
    else document.body.prepend(nav);

    // Click handlers
    nav.querySelectorAll('.vpp-nav-btn, .vpp-nav-dropdown-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const url = btn.getAttribute('data-url');
        if (action === 'home') DashboardBuilder.build();
        else if (url) navigateTo(url);
        nav.querySelectorAll('.vpp-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // More dropdown toggle
    const moreBtn = nav.querySelector('.vpp-nav-more-btn');
    const dropdown = nav.querySelector('.vpp-nav-dropdown');
    if (moreBtn && dropdown) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
      });
      document.addEventListener('click', () => dropdown.classList.remove('show'));
    }
  }

  return { init, navigateTo };
})();
```

---

### Step 1.7: Create `content/main.js`

The entry point that wires everything together.

```javascript
// content/main.js
// Entry point for VTOP++ extension.

(async () => {
  console.log('[VTOP++] Extension loaded');

  if (!VtopAPI.isLoggedIn()) {
    console.log('[VTOP++] Not logged in yet, waiting...');
    return;
  }

  console.log(`[VTOP++] Logged in as ${VtopAPI.getStudentId()}`);

  // Load user preferences
  const prefs = await new Promise(resolve => {
    chrome.storage.sync.get({
      theme: 'dark',
      autoLoadDashboard: true,
      navStyle: 'topbar'
    }, resolve);
  });

  // Apply theme
  document.documentElement.setAttribute('data-vtoppp-theme', prefs.theme);

  // Build custom navigation
  if (prefs.navStyle === 'topbar') NavBuilder.init();

  // Start observing DOM for page changes
  DomObserver.onPageChange((page) => {
    console.log(`[VTOP++] Enhancing page: ${page}`);
  });
  DomObserver.start();

  // Auto-load dashboard
  if (prefs.autoLoadDashboard) {
    const currentPage = PageDetector.detect();
    if (currentPage === 'dashboard' || currentPage === 'unknown') {
      DashboardBuilder.build();
    }
  }

  // Pre-fetch pages in background for instant switching
  setTimeout(() => {
    VtopAPI.cachedPost('/vtop/processViewStudentAttendance', { semesterSubId: 'BL20252605' });
    VtopAPI.cachedPost('/vtop/processViewTimeTable', { semesterSubId: 'BL20252605' });
    VtopAPI.cachedPost('/vtop/examinations/StudentMarkView');
  }, 2000);
})();
```

---

### Step 1.8: Create `background/service-worker.js`

```javascript
// background/service-worker.js
chrome.runtime.onInstalled.addListener(() => {
  console.log('[VTOP++] Extension installed');
  chrome.storage.sync.set({
    theme: 'dark',
    autoLoadDashboard: true,
    navStyle: 'topbar'
  });
});
```

---

### Step 1.9: Create placeholder icons

Run these commands to create simple placeholder icons:

```bash
cd /home/sykik/Dev/vtop++
mkdir -p icons
# Use ImageMagick if available:
convert -size 16x16 xc:'#6C5CE7' icons/icon16.png
convert -size 48x48 xc:'#6C5CE7' icons/icon48.png
convert -size 128x128 xc:'#6C5CE7' icons/icon128.png
```

If ImageMagick is unavailable, create any PNG files of those sizes. They are just placeholders.

---

## 3. Milestone 2: Dark Mode & Theming

### Step 2.1: Create `styles/theme.css`

```css
/* styles/theme.css */
@font-face {
  font-family: 'Inter';
  src: url(chrome-extension://__MSG_@@extension_id__/fonts/Inter-Regular.woff2) format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url(chrome-extension://__MSG_@@extension_id__/fonts/Inter-Medium.woff2) format('woff2');
  font-weight: 500; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url(chrome-extension://__MSG_@@extension_id__/fonts/Inter-SemiBold.woff2) format('woff2');
  font-weight: 600; font-style: normal; font-display: swap;
}

[data-vtoppp-theme="dark"] {
  --vpp-bg-primary: #0f0f13;
  --vpp-bg-secondary: #1a1a24;
  --vpp-bg-card: #1e1e2e;
  --vpp-bg-hover: #2a2a3c;
  --vpp-border: #2d2d3f;
  --vpp-text-primary: #e4e4e9;
  --vpp-text-secondary: #9494a8;
  --vpp-text-muted: #5e5e72;
  --vpp-accent: #6C5CE7;
  --vpp-accent-hover: #7f70f0;
  --vpp-success: #2ed573;
  --vpp-warning: #ffa502;
  --vpp-danger: #ff4757;
  --vpp-info: #45aaf2;
  --vpp-font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --vpp-radius: 12px;
  --vpp-radius-sm: 8px;
  --vpp-shadow: 0 4px 24px rgba(0,0,0,0.3);
}

[data-vtoppp-theme="light"] {
  --vpp-bg-primary: #f5f5f7;
  --vpp-bg-secondary: #ffffff;
  --vpp-bg-card: #ffffff;
  --vpp-bg-hover: #f0f0f4;
  --vpp-border: #e2e2ea;
  --vpp-text-primary: #1a1a2e;
  --vpp-text-secondary: #5e5e72;
  --vpp-text-muted: #9494a8;
  --vpp-accent: #6C5CE7;
  --vpp-accent-hover: #5a4bd1;
  --vpp-success: #26b85e;
  --vpp-warning: #e8950a;
  --vpp-danger: #e63946;
  --vpp-info: #3a9be0;
  --vpp-font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --vpp-radius: 12px;
  --vpp-radius-sm: 8px;
  --vpp-shadow: 0 4px 24px rgba(0,0,0,0.06);
}
```

### Step 2.2: Create `styles/reset.css`

```css
/* styles/reset.css */
body, * { font-family: var(--vpp-font-family) !important; }
body {
  background-color: var(--vpp-bg-primary) !important;
  color: var(--vpp-text-primary) !important;
}
.navbar, .navbar-default, .navbar-fixed-top, nav.navbar {
  background: var(--vpp-bg-secondary) !important;
  border-bottom: 1px solid var(--vpp-border) !important;
  box-shadow: var(--vpp-shadow) !important;
}
.navbar * { color: var(--vpp-text-primary) !important; }
.panel, .panel-default, .box, .card, .well {
  background: var(--vpp-bg-card) !important;
  border: 1px solid var(--vpp-border) !important;
  border-radius: var(--vpp-radius) !important;
  box-shadow: var(--vpp-shadow) !important;
  color: var(--vpp-text-primary) !important;
}
table, .table { color: var(--vpp-text-primary) !important; border-color: var(--vpp-border) !important; }
.table > thead > tr > th {
  background: var(--vpp-bg-hover) !important;
  color: var(--vpp-text-secondary) !important;
  border-color: var(--vpp-border) !important;
  font-weight: 600 !important;
  text-transform: uppercase !important;
  font-size: 11px !important;
  letter-spacing: 0.5px !important;
}
.table > tbody > tr > td {
  border-color: var(--vpp-border) !important;
  color: var(--vpp-text-primary) !important;
}
.table > tbody > tr:hover > td { background: var(--vpp-bg-hover) !important; }
.table-striped > tbody > tr:nth-of-type(odd) { background-color: var(--vpp-bg-secondary) !important; }
.btn, .btn-default, .btn-primary {
  background: var(--vpp-accent) !important;
  border: none !important;
  border-radius: var(--vpp-radius-sm) !important;
  color: #fff !important;
  font-weight: 500 !important;
  transition: background 0.2s ease, transform 0.1s ease !important;
}
.btn:hover { background: var(--vpp-accent-hover) !important; transform: translateY(-1px) !important; }
.form-control, select, input[type="text"], input[type="password"] {
  background: var(--vpp-bg-secondary) !important;
  color: var(--vpp-text-primary) !important;
  border: 1px solid var(--vpp-border) !important;
  border-radius: var(--vpp-radius-sm) !important;
}
.form-control:focus {
  border-color: var(--vpp-accent) !important;
  box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.15) !important;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--vpp-bg-primary); }
::-webkit-scrollbar-thumb { background: var(--vpp-border); border-radius: 3px; }
.dropdown-menu {
  background: var(--vpp-bg-card) !important;
  border: 1px solid var(--vpp-border) !important;
  border-radius: var(--vpp-radius-sm) !important;
  box-shadow: var(--vpp-shadow) !important;
}
.dropdown-menu > li > a, .dropdown-item { color: var(--vpp-text-primary) !important; }
.dropdown-menu > li > a:hover, .dropdown-item:hover { background: var(--vpp-bg-hover) !important; }
a { color: var(--vpp-accent) !important; }
a:hover { color: var(--vpp-accent-hover) !important; }
#core-container, #b3wrapper, #b5wrapper { background: var(--vpp-bg-primary) !important; }
h1, h2, h3, h4, h5, h6 { color: var(--vpp-text-primary) !important; }
*, *::before, *::after {
  transition: background-color 0.2s ease, color 0.15s ease, border-color 0.2s ease !important;
}
```

### Step 2.3: Create `styles/dashboard.css`

```css
/* styles/dashboard.css */
.vpp-dashboard { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
.vpp-section-title {
  font-size: 20px !important; font-weight: 600 !important;
  color: var(--vpp-text-primary) !important;
  margin-bottom: 16px !important; padding-bottom: 8px;
  border-bottom: 2px solid var(--vpp-border);
}
.vpp-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.vpp-card {
  background: var(--vpp-bg-card); border: 1px solid var(--vpp-border);
  border-radius: var(--vpp-radius); padding: 16px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.vpp-card:hover { transform: translateY(-2px); box-shadow: var(--vpp-shadow); }
.vpp-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.vpp-course-code { font-weight: 600; font-size: 15px; color: var(--vpp-text-primary); }
.vpp-course-type {
  font-size: 12px; color: var(--vpp-text-muted);
  background: var(--vpp-bg-hover); padding: 2px 8px; border-radius: 4px;
}
.vpp-attendance-bar-container {
  width: 100%; height: 6px; background: var(--vpp-bg-hover);
  border-radius: 3px; overflow: hidden; margin-bottom: 10px;
}
.vpp-attendance-bar {
  height: 100%; border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.vpp-card-footer { display: flex; justify-content: space-between; font-size: 13px; color: var(--vpp-text-secondary); }
.vpp-attendance-pct { font-weight: 600; font-size: 15px; }
.vpp-spinner {
  width: 24px; height: 24px; border: 3px solid var(--vpp-border);
  border-top-color: var(--vpp-accent); border-radius: 50%;
  animation: vpp-spin 0.8s linear infinite;
}
@keyframes vpp-spin { to { transform: rotate(360deg); } }
.vpp-timetable-container table {
  width: 100%; border-collapse: collapse;
  border-radius: var(--vpp-radius); overflow: hidden;
}
```

### Step 2.4: Create `styles/nav.css`

```css
/* styles/nav.css */
#vpp-nav {
  background: var(--vpp-bg-secondary); border-bottom: 1px solid var(--vpp-border);
  padding: 0 20px; position: sticky; top: 0; z-index: 10000;
  backdrop-filter: blur(12px);
}
.vpp-nav-inner {
  max-width: 1200px; margin: 0 auto; display: flex;
  align-items: center; gap: 32px; height: 52px;
}
.vpp-nav-brand { font-weight: 700; font-size: 20px; color: var(--vpp-text-primary); letter-spacing: -0.5px; flex-shrink: 0; }
.vpp-nav-plus { color: var(--vpp-accent); font-weight: 800; }
.vpp-nav-items { display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.vpp-nav-items::-webkit-scrollbar { display: none; }
.vpp-nav-btn {
  display: flex; align-items: center; gap: 6px; padding: 6px 14px;
  border: none; background: transparent; color: var(--vpp-text-secondary);
  font-size: 13px; font-weight: 500; border-radius: var(--vpp-radius-sm);
  cursor: pointer; white-space: nowrap; transition: all 0.15s ease;
  font-family: var(--vpp-font-family) !important;
}
.vpp-nav-btn:hover { background: var(--vpp-bg-hover); color: var(--vpp-text-primary); }
.vpp-nav-btn.active { background: var(--vpp-accent); color: #fff; }
.vpp-nav-icon { font-size: 16px; }
.vpp-nav-more { position: relative; }
.vpp-nav-dropdown {
  display: none; position: absolute; top: calc(100% + 8px); right: 0;
  background: var(--vpp-bg-card); border: 1px solid var(--vpp-border);
  border-radius: var(--vpp-radius); box-shadow: var(--vpp-shadow);
  min-width: 200px; padding: 6px; z-index: 10001;
}
.vpp-nav-dropdown.show { display: block; animation: vpp-fade-in 0.15s ease; }
.vpp-nav-dropdown-item {
  display: block; width: 100%; padding: 8px 12px; border: none;
  background: transparent; color: var(--vpp-text-primary); font-size: 13px;
  font-weight: 500; text-align: left; border-radius: var(--vpp-radius-sm);
  cursor: pointer; font-family: var(--vpp-font-family) !important;
}
.vpp-nav-dropdown-item:hover { background: var(--vpp-bg-hover); }
@keyframes vpp-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Step 2.5: Create `styles/responsive.css`

```css
/* styles/responsive.css */
@media (max-width: 768px) {
  .vpp-nav-inner { gap: 12px; padding: 0 8px; }
  .vpp-nav-label { display: none; }
  .vpp-nav-btn { padding: 8px 10px; }
  .vpp-nav-icon { font-size: 20px; }
  .vpp-card-grid { grid-template-columns: 1fr; gap: 12px; }
  .vpp-dashboard { padding: 12px 8px; }
  #b3wrapper table, #b5wrapper table {
    display: block; overflow-x: auto;
    -webkit-overflow-scrolling: touch; white-space: nowrap;
  }
  .vpp-card { padding: 14px; }
  .btn { min-height: 44px !important; min-width: 44px !important; font-size: 14px !important; }
}
@media (max-width: 480px) {
  .vpp-nav-brand { font-size: 16px; }
  .vpp-section-title { font-size: 16px !important; }
}
```

---

## 4. Milestone 3 & 4: Popup Settings

### Step 3.1: Create `popup/popup.html`

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head><body>
  <h1>VTOP<span class="plus">++</span></h1>
  <div class="setting">
    <label>Theme</label>
    <select id="theme">
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </div>
  <div class="setting">
    <label>Auto-Load Dashboard</label>
    <input type="checkbox" id="autoLoad" checked>
  </div>
  <div class="setting">
    <label>Navigation Style</label>
    <select id="navStyle">
      <option value="topbar">Top Bar (Modern)</option>
      <option value="sidebar-original">Original Sidebar</option>
    </select>
  </div>
  <button id="save">Save & Reload</button>
  <script src="popup.js"></script>
</body></html>
```

### Step 3.2: Create `popup/popup.css`

```css
body { width: 240px; padding: 16px; font-family: 'Segoe UI', sans-serif; background: #1a1a24; color: #e4e4e9; }
h1 { font-size: 18px; margin: 0 0 16px; }
.plus { color: #6C5CE7; }
.setting { margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
label { font-size: 13px; }
select, input { background: #2a2a3c; color: #e4e4e9; border: 1px solid #2d2d3f; border-radius: 6px; padding: 4px 8px; }
button {
  width: 100%; padding: 8px; background: #6C5CE7; color: #fff;
  border: none; border-radius: 8px; cursor: pointer; font-weight: 600; margin-top: 8px;
}
button:hover { background: #7f70f0; }
```

### Step 3.3: Create `popup/popup.js`

```javascript
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get({ theme: 'dark', autoLoadDashboard: true, navStyle: 'topbar' }, (prefs) => {
    document.getElementById('theme').value = prefs.theme;
    document.getElementById('autoLoad').checked = prefs.autoLoadDashboard;
    document.getElementById('navStyle').value = prefs.navStyle;
  });

  document.getElementById('save').addEventListener('click', () => {
    chrome.storage.sync.set({
      theme: document.getElementById('theme').value,
      autoLoadDashboard: document.getElementById('autoLoad').checked,
      navStyle: document.getElementById('navStyle').value
    }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.reload(tabs[0].id);
      });
      window.close();
    });
  });
});
```

---

## 5. Fonts

Download Inter font woff2 files and place them in `/home/sykik/Dev/vtop++/fonts/`:

```bash
cd /home/sykik/Dev/vtop++
mkdir -p fonts
# Download from Google Fonts CDN:
curl -L -o fonts/Inter-Regular.woff2 "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2"
curl -L -o fonts/Inter-Medium.woff2 "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fAZ9hiA.woff2"
curl -L -o fonts/Inter-SemiBold.woff2 "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYAZ9hiA.woff2"
```

If URLs are stale, go to https://fonts.google.com/specimen/Inter, download, and convert to woff2. Or just remove the `@font-face` rules from `theme.css` to use system fonts as fallback.

---

## 8. VTOP Technical Reference

### Authentication Variables
| Variable | Where | Example |
|---|---|---|
| `csrfValue` | Inline `<script>` global | `"f08773ac-ad33-4dea-9414-0ecb404d0270"` |
| `id` | Inline `<script>` global | `"24BCY10147"` |
| `JSESSIONID` | Cookie | `<session hash>` |

### Standard POST Body
```
_csrf={csrfValue}&authorizedID={id}&x={new Date().toUTCString()}
```

### Endpoint Quick Reference
| What | Endpoint | Extra Params |
|---|---|---|
| Dashboard courses | `/vtop/get/dashboard/current/semester/course/details` | — |
| Dashboard CGPA | `/vtop/get/dashboard/current/cgpa/credits` | — |
| Attendance (page) | `/vtop/academics/common/StudentAttendance` | — |
| Attendance (data) | `/vtop/processViewStudentAttendance` | `semesterSubId` |
| Timetable (page) | `/vtop/academics/common/StudentTimeTable` | — |
| Timetable (data) | `/vtop/processViewTimeTable` | `semesterSubId` |
| Marks | `/vtop/examinations/StudentMarkView` | — |
| Grades | `/vtop/examinations/examGradeView/StudentGradeView` | — |
| Exam Schedule | `/vtop/examinations/StudExamSchedule` | — |

### DOM Targets
| Selector | Purpose |
|---|---|
| `#b3wrapper` | Main content injection target |
| `#b5wrapper` | Alt layout content target |
| `#core-container` | Outer content wrapper |
| `.systemMainMenu` | Sidebar nav link class |
| `#semesterSubId` | Semester dropdown select element |

### Known Semester IDs
| Semester | ID |
|---|---|
| Winter 2025-26 | `BL20252605` |

---

## 9. Verification Plan

### Test 1: Extension Loads Without Errors
1. Open Chrome → `chrome://extensions` → Enable "Developer mode"
2. Click "Load unpacked" → select `/home/sykik/Dev/vtop++/`
3. Navigate to `https://vtop.vitbhopal.ac.in/vtop`
4. Open DevTools Console (F12 → Console)
5. **Expected**: `[VTOP++] Extension loaded` in console, no red errors

### Test 2: Dark Theme Applies
1. Log into VTOP
2. **Expected**: Dark background, light text, styled tables & buttons everywhere

### Test 3: Navigation Bar
1. After login, original sidebar should be hidden
2. Centered horizontal nav bar should appear with Dashboard, Attendance, Timetable, Marks, Grades, Exams buttons
3. **Expected**: All buttons visible, "More" dropdown works

### Test 4: Navigation Works
1. Click each nav button
2. **Expected**: Each loads correct page content with loading spinner

### Test 5: Dashboard Auto-Loads
1. Log in → home page
2. **Expected**: Attendance cards with progress bars + timetable appear automatically

### Test 6: Mobile Responsive
1. DevTools → Toggle Device Toolbar (Ctrl+Shift+M) → iPhone size
2. **Expected**: Icon-only nav, single-column cards, scrollable tables

### Test 7: Popup Settings
1. Click the VTOP++ extension icon in Chrome toolbar
2. Change theme to Light → Save & Reload
3. **Expected**: Page reloads with light theme

> [!CAUTION]
> **If tests fail**, check DevTools Console. Common issues:
> - `csrfValue is not defined` → check `run_at` in manifest
> - `Failed to fetch` → verify `credentials: 'same-origin'`
> - Styles not applying → verify CSS files listed in manifest


---

## KNOWN GAPS (added during the 2026 fold)

Issues to resolve before implementing any of the above:

1. **Hardcoded semester.** `BL20252605` is hardcoded in
   `dashboard-builder.js` and `main.js`. Must be discovered from the
   `#semesterSubId` select in the live DOM and cached per user.
2. **Fetched HTML won't execute scripts.** Both the dashboard and
   `navigateTo()` inject VTOP responses via
   `wrapper.innerHTML = html`. `<script>` tags inside fragments
   assigned via innerHTML never run, and VTOP leans on inline scripts.
   Either re-execute scripts (clone nodes into `document`) or rewrite
   the pages' required interactions as event delegation owned by
   vtop++, not the fetched markup.
3. **Auth globals timing unverified.** Plan assumes `csrfValue`/`id`
   exist when `document_idle` fires; verify, and treat
   "not logged in yet" with an observable retry, not a single check.
4. **Scripts are placed in line, not run** - when porting, the
   module files listed in `content_scripts` must stay ordered
   (`vtop-api` -> `page-detector` -> `dom-observer` -> ...) exactly
   like the plan shows or nothing executes.
5. **Packaging path bug (fixed in the 2026 restructure).** The old
   package script expected an `extension/` subdir that did not exist;
   extension sources now live in `extension/`, so the script works.
6. **Remote-code/platform store rules.** Shipping HTML fetched from
   VTOP via fetch into the page is allowed (user data), but keep all
   vtop++ logic local; no eval, no remote `<script>` start.
7. **Plan CSS relies on `chrome-extension://__MSG_@@extension_id__`
   font URLs.** Verify that substitution works for CSS served as a
   content-script stylesheet; if not, construct font URLs at runtime
   from `chrome.runtime.getURL()`.
