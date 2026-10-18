import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const sourceRoot = join(projectRoot, 'android', 'app', 'src', 'main', 'java');
const kotlinRoot = join(projectRoot, 'android', 'app', 'src', 'main', 'kotlin');

function findMainActivity(directory) {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const found = findMainActivity(path);
      if (found) return found;
    } else if (entry === 'MainActivity.java' || entry === 'MainActivity.kt') {
      return path;
    }
  }
  return null;
}

const activityPath = findMainActivity(sourceRoot) || findMainActivity(kotlinRoot);
if (!activityPath) throw new Error('Capacitor MainActivity was not found under src/main/java or src/main/kotlin');
const activity = readFileSync(activityPath, 'utf8');
const packageMatch = activity.match(/^package\s+([\w.]+);?/m);
if (!packageMatch) throw new Error('Cannot determine the generated Android package name');
const packageName = packageMatch[1];
const packagePath = join(sourceRoot, ...packageName.split('.'));
mkdirSync(packagePath, { recursive: true });

const pluginSource =
  'package ' + packageName + ';\n\n' +
  'import android.content.ContentValues;\n' +
  'import android.content.Context;\n' +
  'import android.content.SharedPreferences;\n' +
  'import android.net.Uri;\n' +
  'import android.os.Build;\n' +
  'import android.os.Environment;\n' +
  'import android.provider.MediaStore;\n' +
  'import android.provider.Settings;\n' +
  'import android.util.Base64;\n' +
  'import com.getcapacitor.JSObject;\n' +
  'import com.getcapacitor.Plugin;\n' +
  'import com.getcapacitor.PluginCall;\n' +
  'import com.getcapacitor.PluginMethod;\n' +
  'import com.getcapacitor.annotation.CapacitorPlugin;\n' +
  'import java.io.File;\n' +
  'import java.io.FileOutputStream;\n' +
  'import java.io.OutputStream;\n' +
  'import java.util.UUID;\n\n' +
  '@CapacitorPlugin(name = "KoptilnyaDownloads")\n' +
  'public class KoptilnyaDownloadsPlugin extends Plugin {\n' +
  '  @PluginMethod\n' +
  '  public void getLicenseIdentity(PluginCall call) {\n' +
  '    String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);\n' +
  '    if (id == null || id.trim().isEmpty()) {\n' +
  '      SharedPreferences prefs = getContext().getSharedPreferences("koptilnya_license", Context.MODE_PRIVATE);\n' +
  '      id = prefs.getString("deviceId", null);\n' +
  '      if (id == null || id.trim().isEmpty()) { id = UUID.randomUUID().toString(); prefs.edit().putString("deviceId", id).apply(); }\n' +
  '    }\n' +
  '    JSObject result = new JSObject();\n' +
  '    result.put("deviceId", id);\n' +
  '    call.resolve(result);\n' +
  '  }\n' +
  '  @PluginMethod\n' +
  '  public void getTrialState(PluginCall call) {\n' +
  '    SharedPreferences prefs = getContext().getSharedPreferences("koptilnya_license", Context.MODE_PRIVATE);\n' +
  '    JSObject result = new JSObject();\n' +
  '    result.put("firstRunAt", prefs.getLong("firstRunAt", 0L));\n' +
  '    result.put("lastSeenAt", prefs.getLong("lastSeenAt", 0L));\n' +
  '    call.resolve(result);\n' +
  '  }\n' +
  '  @PluginMethod\n' +
  '  public void saveTrialState(PluginCall call) {\n' +
  '    long incomingFirst = call.getData().optLong("firstRunAt", 0L);\n' +
  '    long incomingLast = call.getData().optLong("lastSeenAt", 0L);\n' +
  '    SharedPreferences prefs = getContext().getSharedPreferences("koptilnya_license", Context.MODE_PRIVATE);\n' +
  '    long oldFirst = prefs.getLong("firstRunAt", 0L);\n' +
  '    long oldLast = prefs.getLong("lastSeenAt", 0L);\n' +
  '    long nextFirst = oldFirst == 0L ? incomingFirst : (incomingFirst == 0L ? oldFirst : Math.min(oldFirst, incomingFirst));\n' +
  '    long nextLast = Math.max(oldLast, incomingLast);\n' +
  '    prefs.edit().putLong("firstRunAt", nextFirst).putLong("lastSeenAt", nextLast).apply();\n' +
  '    call.resolve();\n' +
  '  }\n' +
  '  @PluginMethod\n' +
  '  public void saveToDownloads(PluginCall call) {\n' +
  '    String fileName = call.getString("fileName");\n' +
  '    String mimeType = call.getString("mimeType");\n' +
  '    String encodedData = call.getString("data");\n' +
  '    if (fileName == null || fileName.trim().isEmpty() || encodedData == null) {\n' +
  '      call.reject("Не указаны имя или содержимое файла");\n' +
  '      return;\n' +
  '    }\n' +
  '    if (mimeType == null || mimeType.trim().isEmpty()) mimeType = "application/octet-stream";\n' +
  '    try {\n' +
  '      byte[] bytes = Base64.decode(encodedData, Base64.DEFAULT);\n' +
  '      JSObject result = new JSObject();\n' +
  '      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {\n' +
  '        ContentValues values = new ContentValues();\n' +
  '        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);\n' +
  '        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);\n' +
  '        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Коптильня");\n' +
  '        values.put(MediaStore.MediaColumns.IS_PENDING, 1);\n' +
  '        Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);\n' +
  '        if (uri == null) throw new IllegalStateException("Android не создал файл в Загрузках");\n' +
  '        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {\n' +
  '          if (output == null) throw new IllegalStateException("Не удалось открыть файл в Загрузках");\n' +
  '          output.write(bytes);\n' +
  '        }\n' +
  '        ContentValues ready = new ContentValues();\n' +
  '        ready.put(MediaStore.MediaColumns.IS_PENDING, 0);\n' +
  '        getContext().getContentResolver().update(uri, ready, null, null);\n' +
  '        result.put("uri", uri.toString());\n' +
  '        result.put("path", "Download/Коптильня/" + fileName);\n' +
  '      } else {\n' +
  '        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);\n' +
  '        if (base == null) throw new IllegalStateException("Папка загрузок недоступна");\n' +
  '        File folder = new File(base, "Коптильня");\n' +
  '        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Не удалось создать папку");\n' +
  '        File outputFile = new File(folder, fileName);\n' +
  '        try (FileOutputStream output = new FileOutputStream(outputFile)) { output.write(bytes); }\n' +
  '        result.put("uri", Uri.fromFile(outputFile).toString());\n' +
  '        result.put("path", outputFile.getAbsolutePath());\n' +
  '      }\n' +
  '      result.put("fileName", fileName);\n' +
  '      call.resolve(result);\n' +
  '    } catch (Exception error) {\n' +
  '      call.reject("Не удалось сохранить файл в Загрузки/Коптильня", error);\n' +
  '    }\n' +
  '  }\n' +
  '}\n';

writeFileSync(join(packagePath, 'KoptilnyaDownloadsPlugin.java'), pluginSource, 'utf8');

const isKotlin = activityPath.endsWith('.kt');
const mainActivity = isKotlin
  ? 'package ' + packageName + '\n\n' +
    'import android.os.Bundle\n' +
    'import com.getcapacitor.BridgeActivity\n\n' +
    'class MainActivity : BridgeActivity() {\n' +
    '  override fun onCreate(savedInstanceState: Bundle?) {\n' +
    '    registerPlugin(KoptilnyaDownloadsPlugin::class.java)\n' +
    '    super.onCreate(savedInstanceState)\n' +
    '  }\n' +
    '}\n'
  : 'package ' + packageName + ';\n\n' +
    'import android.os.Bundle;\n' +
    'import com.getcapacitor.BridgeActivity;\n\n' +
    'public class MainActivity extends BridgeActivity {\n' +
    '  @Override\n' +
    '  public void onCreate(Bundle savedInstanceState) {\n' +
    '    registerPlugin(KoptilnyaDownloadsPlugin.class);\n' +
    '    super.onCreate(savedInstanceState);\n' +
    '  }\n' +
    '}\n';
writeFileSync(activityPath, mainActivity, 'utf8');

const manifestPath = join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!existsSync(manifestPath)) throw new Error('Generated AndroidManifest.xml was not found');
let manifest = readFileSync(manifestPath, 'utf8');
const mainActivityPattern = /(<activity\b(?=[^>]*\bandroid:name="[^"]*MainActivity")[^>]*>)([\s\S]*?)(<\/activity>)/;
if (!mainActivityPattern.test(manifest)) throw new Error('Could not locate the Capacitor MainActivity in AndroidManifest.xml');
manifest = manifest.replace(mainActivityPattern, (whole) => whole);
writeFileSync(manifestPath, manifest, 'utf8');
console.log('Registered Downloads plugin and offline license/trial methods.');