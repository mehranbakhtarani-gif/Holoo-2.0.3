# Android PWA release readiness

## Current delivery type

This repository currently ships a Progressive Web App (PWA) through GitHub Pages. It is not a native Android project and this release does not produce a signed APK or AAB. The in-app action labelled «نصب روی اندروید» uses the browser's `beforeinstallprompt` event when Chrome makes it available; otherwise the user must use Chrome's menu and choose Install app / Add to Home screen.

## Verified repository configuration

- Web app manifest declares Persian RTL metadata, standalone display, portrait orientation, and 192/512 SVG icons.
- The page registers `sw.js` on HTTPS and requests persistent browser storage only after the user taps the relevant control.
- The service worker uses a versioned shell cache, claims clients after activation, and does not intercept Supabase REST/auth/storage traffic.
- Navigation is network-first with the cached app shell as offline fallback. Same-origin static GET assets are cached on first successful fetch.
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
- Confirm the selected operator is correct on each device. Operator/device labels are operational metadata, not authentication; with no login/password, they do not prevent impersonation.
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
- The application currently uses external CDN resources (Tailwind, Chart.js, and Vazirmatn fonts). The service worker can cache these after a successful online fetch, but a fresh installation on a device that has never loaded online is not guaranteed to run fully offline.
- The SVG manifest icons are present, but install behavior must be confirmed in Chrome on the target Android version.
- Live Supabase migration history was checked on 2026-11-18 and confirms that `payroll_fixed_asset_sync_collections`, `guarantees_payable_commitments`, and `same_device_sequential_merge` are applied. The `holoo_apply_state_operation` RPC is present as `SECURITY INVOKER`. This confirms schema/RPC deployment only; the three-physical-device acceptance test below is still required.

## Data safety

This stage must not alter company records, production Supabase rows, RLS policies, or existing accounting vouchers. Keep the current no-password requirement visible as a security limitation: actor names and device labels are not verified identities.
