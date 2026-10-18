# Коптильня — автономное Android-приложение

The local-licensing build is designed to work **without account registration, internet access, or Supabase**. All accounting entries remain in the app's local database on the device.

## Trial and activation

- First launch starts a 7-day trial.
- After the trial, the main workspace is locked until a signed activation key is entered.
- Activation plans: 1 month (30 days), 3 months (90 days), 6 months (180 days), and 12 months (365 days).
- Keys are bound to the device code shown on the License screen. The customer sends that code to the seller; the seller returns a key generated with the separate private-key issuer tool.
- The private signing key is **not** stored in this public repository or inside the APK. Keep the seller's issuer package backed up securely and never share it.
- When a trial/license expires, records are not deleted. The License screen keeps an option to export a full backup before reactivation.

Offline license verification uses an ECDSA P-256 signature. The app embeds only the public verification key; the issuer holds the corresponding private key. This is a practical offline licensing mechanism, not tamper-proof DRM: advanced users controlling their device can patch a client app or reset its local data.

## Data storage and backups

- Product cards, customers, documents, expenses, payments, production batches, and other app state are saved locally.
- Excel import is read on-device, shows a preview, and creates a backup before replacing existing records.
- **Download full archive** creates a ZIP containing the JSON database, Excel financial reports, product photos, document attachments, and a manifest.
- Restore from the ZIP reconstructs photos and document attachments. Keep a copy outside the phone before app reinstall or device replacement.
- This build does not synchronize between devices. Data on one device does not automatically appear on another.

## Build a test APK

Requirements: Node.js 22+, Android Studio, JDK 21, Android SDK Platform 36, and Build Tools 36.0.0.

```bash
cd smokehouse-android
npm install
npm test
npm run build
npx cap add android
node scripts/install-download-plugin.mjs
npx cap sync android
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`.

GitHub Actions on branch `koptilnya-local-licensing` runs the tests and builds a debug APK. A debug APK is for test installation and is not a signed Play Store release. Before distributing paid copies long-term, create a stable release keystore and sign every customer APK/update with the same keystore. The current CI debug APK is suitable for testing/initial evaluation, not a substitute for a managed production signing key.

## Important operational notes

- Android's app-specific trial state is stored in native SharedPreferences, and the license is bound to the Android ID exposed to this app. Clearing application data or reinstalling can reset local records/trial state; export a ZIP before changing devices or reinstalling.
- The database is local to this installation; losing or uninstalling the app without a separate backup can lose all records.
- The license issuer's private PEM file is equivalent to the business's master key: anyone with it can generate licenses. Keep a protected offline backup and never upload it to GitHub.
- The prior Supabase project is not deleted because it is shared with the separate Technopark application. This build no longer bundles a Supabase client or contacts that service at runtime.
