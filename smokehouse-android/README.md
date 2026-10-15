# Коптильня — Android test build

This branch builds an installable **debug APK** for functional testing. It is not a production release.

## Get and install the test APK

1. Download `Koptilnya-Android-Test.apk` from the conversation attachment, or open the latest successful [Android build workflow](https://github.com/cbklexa-bot/technopark-app/actions/workflows/smokehouse-android-build.yml?query=branch%3Asmokehouse-android) and download the artifact named `koptilnya-android-test-build`.
2. Transfer the APK to an Android phone and open it. Android may ask to allow installation from the app used to open the file; enable this only for the install and then turn it off if desired.
3. This is a debug-signed test build. It is not the signed Play Store release package.

## Local build

Requirements: Node.js 22+, Android Studio, JDK 21, Android SDK Platform 36, and Build Tools 36.0.0.

```bash
cd smokehouse-android
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

To build a local debug APK after installing the required SDKs:

```bash
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`.

## Current functionality and limitations

The Android shell packages the current app interface and the existing accounting/CRM prototype. Data still lives only in the app's local storage on that device; there is no cloud account or cross-device sync yet. The app starts with demonstration records; don't use it as the sole place for real business records.

The app includes a full ZIP archive with a JSON database snapshot, an Excel workbook (summary, products, clients, documents, line items, expenses, payments, production batches, recipes, product sales, services, monthly financial summaries), product photos and document attachments. The ZIP can be restored with the in-app restore control; older JSON backups remain supported. On Android, the archive and CSV exports open the native share/save chooser. Test these flows on a real device, because CI cannot simulate every file manager or share target.

The ZIP/Excel export is local to this test device. It does not replace the future server-side export after subscription expiration; cloud records, account-level export, and account retention still require the production backend.

## Remaining product work before production use

1. Provision a **new, separate** production backend; do not connect this to Technopark or song-app databases.
2. Implement authentication and tenant isolation (each business sees only its own data), cloud records, file storage, backup and restore.
3. Add trial/subscription lifecycle and server-side entitlement checks; after expiration switch to read-only and keep the full export available.
4. Add Google Play Billing when subscription implementation begins.
5. Complete financial acceptance tests, inspect layouts on multiple real Android screen sizes, validate export/import including large photos, and add an audit trail/backups.
6. Finalize app icon, privacy and data deletion flows, support details, and a release-signing process.

## Native details

- App ID: `ru.koptilnya.app` (provisional).
- Capacitor core/Android: `8.5.3`.
- Android SDK target used by CI: API 36.
- CI build artifact retention is 14 days; the attached APK saved in the conversation is a separate copy.

## Official documentation

- [Capacitor setup](https://capacitorjs.com/docs/getting-started)
- [Filesystem API](https://next.capacitorjs.com/docs/apis/filesystem)
- [Share API](https://capacitor-site.vercel.app/docs/apis/share)
