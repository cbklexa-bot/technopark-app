# Коптильня — Android build track

This folder contains a Capacitor Android wrapper for the current mobile-first prototype. It is a **development build track**, not yet a production or Play Store release.

## Build locally

Requirements: Node.js 22+, Android Studio 2025.2.1 or newer, Android SDK Platform 36, and a JDK compatible with the generated Gradle project. Capacitor 8 currently requires Node.js 22+ and Android Studio 2025.2.1+; Google Play requires new apps and updates to target API 36 as of 31 August 2026. See the official guides linked below.

```bash
cd smokehouse-android
npm install
npx cap add android
npx cap sync android
npx cap open android
```

To build a local debug APK after Android Studio has installed the required SDKs:

```bash
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`.

## Automated test build

The GitHub Actions workflow at `.github/workflows/smokehouse-android-build.yml` creates the native wrapper and produces an installable debug APK. This APK is for testing only. It is not the signed, release-ready AAB for Google Play.

## Important production blockers

The HTML currently copied into `www/` still uses browser local storage and demonstration records. Wrapping it in Android does not add user accounts, a cloud database, cross-device sync, server-side subscription checks, Play Billing, protected expired-subscription read-only mode, or server-generated full exports. The JSON backup/export included here saves the state on this device, including image data and document attachments saved within that state; it is not a replacement for the future cloud export archive.

Before public launch, the next production milestones are:

1. Provision a **new, separate** production backend; do not connect the app to existing Technopark or song-app databases.
2. Implement authentication and tenant isolation (every business sees only its own data), remote image/file storage, backup and restore.
3. Add subscription/trial lifecycle with server-side entitlement checks and Google Play Billing integration, and retain read-only access plus full export after expiration.
4. Complete invoice/financial acceptance tests using representative real-world cases and test on Android devices.
5. Prepare the privacy policy, account/data deletion flows, support contact, Play Store listing, release signing key, and signed AAB. Store publication itself needs the owner's Play Console and identity/account setup.

## Official requirements

- Capacitor installation: https://capacitorjs.com/docs/getting-started
- Capacitor Android environment: https://capacitorjs.com/docs/getting-started/environment-setup
- Google Play target API requirement: https://support.google.com/googleplay/android-developer/answer/11926878
- Play Billing subscriptions: https://developer.android.com/google/play/billing/subscriptions

## Package name

`ru.koptilnya.app` is provisional. Confirm its availability and finalize it before the first public Play Store release; changing the application ID after release would be disruptive.
