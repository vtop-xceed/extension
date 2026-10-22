# VTOP++ Addons

Browser extension (Chrome + Firefox) for VTOP.

- **Captcha solver** (shipped): auto-solves the VTOP login captcha by
  calling the AutoCaptcha API, reports failed reads back for training.
- **UI overhaul** (planned): the big dashboard theming + top-nav
  rework. Spec: `docs/plans/ui-overhaul.md` (see its KNOWN GAPS
  section before implementing).

## Development

```sh
# Chrome: chrome://extensions -> Load unpacked -> select extension/
# Firefox: about:debugging#/runtime/this-firefox -> Load Temporary Add-on
#          -> pick extension/manifest.json
```

Bundle a release (needs zip, rsync; optional `.pem` for a .crx):

```sh
./package_extensions.sh            # builds Chrome zip + Firefox zip
./package_extensions.sh v1.4.2 captop-chrome.pem
```

## Behavioral notes

- The host page CSP blocks fetch from the content script, so all API
  calls happen in `background.js`.
- Failure reports are user-toggleable (popup: "Share failed captchas
  for training", default ON). They post the captcha image + prediction
  + `source: "extension"` to the API; see
  `auto-captcha/docs/intake-contract.md`.
- A red `!` badge appears if the login page stops matching
  `#captchaBlock img` (VTOP redesign radar).
- Endpoints live in `extension/js/constants.js`; do not hardcode them
  elsewhere.

## Where to start (known gaps backlog)

1. `docs/plans/ui-overhaul.md` KNOWN GAPS 1-7.
2. Add a lightweight DOM test harness for `content.js` selectors so
   VTOP DOM changes fail a test instead of a user.
3. Publish to stores: listing text + screenshots + privacy disclosure
   (third-party API posting the captcha image) + `docs/privacy.md`.
