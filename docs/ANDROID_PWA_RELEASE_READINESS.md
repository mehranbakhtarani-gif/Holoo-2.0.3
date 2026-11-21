# Android PWA release readiness

## Current delivery type

This repository currently ships a Progressive Web App (PWA) through GitHub Pages. It is not a native Android project and this release does not produce a signed APK or AAB. The in-app action labelled «نصب روی اندروید» uses the browser's `beforeinstallprompt` event when Chrome makes it available; otherwise the user must use Chrome's menu and choose Install app / Add to Home screen.

## Verified repository configuration

- Web app manifest declares Persian RTL metadata, standalone display, portrait orientation, and 192/512 SVG icons.
- The page registers `sw.js` on HTTPS and requests persistent browser storage only after the user taps the relevant control.
- The service worker uses a versioned shell cache, pre-caches every first-party JavaScript module referenced by the page, claims clients after activation, and does not intercept Supabase REST/auth/storage traffic.
- Navigation is network-first with the cached app shell as offline fallback. First-party application scripts are available from the install-time shell cache; other same-origin static GET assets are cached on first successful fetch.
- CDN assets are cached on first successful fetch for the explicitly allowlisted hosts.
- Cloud sync is not an offline database: receiving/sending cloud data requires connectivity. A local app shell being available offline does not mean another device's latest accounting data is available offline.

## Installation on Android

1. Open the deployed HTTPS site in current Google Chrome.
2. Wait until the app has loaded fully at least once while online.
3. Open Chrome's three-dot menu and choose **Install app** (or **Add to Home screen**, depending on Chrome/device).
4. Launch from the new home-screen icon.
5. Open Settings in the app and create/download a backup before entering or changing real accounting records.
6. Repeat the installation independently on each intended device. A device ID is generated per browser installation; changing browser profile or clearing site data may create a new identity.

## Required acceptance tests on physical devices

These cannot be proven by static CI alone and must be checked on the actual Android phones:

- Install and launch on the Mehran device and both Ehsan devices.
- Confirm each installation shows its own stable device identifier after closing and reopening.
- On first launch after this update, confirm the one-time device assignment: مهران on the Mehran phone and احسان on each of the two Ehsan phones. The assignment is stored locally per installation and the operator selector is locked afterward. Operator/device labels remain operational metadata, not authentication; with no login/password, they do not prevent impersonation.
- While online, receive cloud data and confirm the app displays the expected latest state.
- Make a controlled test change only in a non-production/test dataset, send it, and confirm the other devices receive it without duplicate posting or lost updates.
- Disable connectivity, close/reopen the app, and confirm the shell opens. Do not treat an offline shell test as proof that cloud sync works offline.
- Restore connectivity and verify the pending sync queue clears only after server confirmation.
- Download a JSON backup and verify it appears in Android Downloads. Protect this file because it contains financial/company data.
- Test print/save-as-PDF, CSV opening in a spreadsheet app, and barcode scanning with the actual printer/scanner hardware.
- Update the deployed version and confirm the app refreshes to the new release without losing local/cloud data.

## Release blockers / limitations

- No signed APK/AAB, Android Studio project, Capacitor wrapper, Play Store package, or signing keystore is present in this repository.
- The three-device acceptance test is pending because the two Ehsan devices are not currently available.
- Physical Android download, printer, scanner, and PDF flows have not been tested by CI.
- The application currently uses external CDN resources (Tailwind, Chart.js, and Vazirmatn fonts). The service worker can cache these after a successful online fetch, but a fresh installation on a device that has never loaded online is not guaranteed to run fully offline. Install and first-load testing must therefore be performed while connected.
- The SVG manifest icons are present, but install behavior must be confirmed in Chrome on the target Android version.
- Live Supabase migration history was checked on 2026-11-18 and confirms that `payroll_fixed_asset_sync_collections`, `guarantees_payable_commitments`, and `same_device_sequential_merge` are applied. The `holoo_apply_state_operation` RPC is present as `SECURITY INVOKER`. This confirms schema/RPC deployment only; the three-physical-device acceptance test below is still required.

## Data safety

This stage must not alter company records, production Supabase rows, RLS policies, or existing accounting vouchers. Keep the current no-password requirement visible as a security limitation: actor names and device labels are not verified identities.


## Manual recovery drill — isolated test environment only

Do not perform destructive storage tests against the live company or production Supabase record. Use a disposable browser profile and an isolated test company/database with no real vouchers. Export a backup first and record the deployed commit, browser version, device model, and test timestamp.

### Test A — recover from a damaged localStorage snapshot

1. Load the test app online and wait until the local mirror and operation queue are ready.
2. Create one uniquely identifiable test product and confirm the save completes. Record its ID and expected value.
3. In browser developer tools, inspect the app's local storage and IndexedDB. Identify the app snapshot and its mirror stores from the running build; do not guess database or key names.
4. Close the app, then corrupt only the localStorage snapshot value in the disposable profile. Leave IndexedDB intact.
5. Reopen the app. Pass only if the valid IndexedDB mirror is selected, the product value is unchanged, the app reports readiness, and no duplicate operation is created.

### Test B — recover from a damaged IndexedDB mirror

1. Start from a fresh test profile with a valid snapshot and a completed save.
2. Close the app and damage only the app's IndexedDB snapshot/mirror record. Keep the localStorage snapshot intact.
3. Reopen the app. Pass only if the structurally valid localStorage snapshot is retained and the mirror is rebuilt without changing accounting values or inventing a journal operation.

### Test C — both local copies invalid

1. Use a disposable profile and isolated test company only. Ensure there are no pending local operations, outbox markers, or unresolved conflicts.
2. Create and cloud-confirm a test product change; verify its matching operation-history checkpoint exists on the test backend.
3. Close the app and invalidate both local snapshot copies in the disposable profile.
4. Reopen while online. Pass only if the complete remote snapshot and complete operation history are fetched, the snapshot checkpoint matches the journal, and the recovered state plus history are persisted together.
5. Repeat with an intentionally incomplete/changed history response in a controlled test harness. Pass only if recovery fails closed and does not promote a partial snapshot.

### Test D — pending queue, transport interruption, and conflict

1. Queue at least three distinct test operations on one device.
2. Interrupt network access during upload of the second operation.
3. Reopen the app and restore connectivity. Pass only if the first server-confirmed operation is acknowledged, the second and third remain ordered and pending, and retries reuse stable operation IDs.
4. In a separate test, cause a baseline conflict. Pass only if the conflicting operation and all later operations remain pending and no automatic overwrite or merge occurs.

### Evidence to capture

For every test, record: pass/fail, app commit, device/browser, local snapshot before/after, operation IDs and sequence numbers, cloud checkpoint timestamp, pending queue before/after, and a screenshot or sanitized log. Never include API keys, authorization headers, customer names, or real accounting data in evidence.

| Drill | Required result | Status |
|---|---|---|
| A — localStorage damaged, IndexedDB valid | Recover mirror; no duplicate journal operation | Not run on physical browser |
| B — IndexedDB damaged, localStorage valid | Preserve local snapshot; rebuild mirror | Not run on physical browser |
| C — both local copies damaged | Complete checkpoint-verified cloud recovery or fail closed | Not run on physical browser |
| D — mid-queue interruption/conflict | Preserve order and all unacknowledged operations | Simulated CI only |
