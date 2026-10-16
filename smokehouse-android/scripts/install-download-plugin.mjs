import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(root, 'android', 'app', 'src', 'main', 'java');

function findMainActivity(directory) {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const found = findMainActivity(path);
      if (found) return found;
    } else if (entry === 'MainActivity.java') {
      return path;
    }
  }
  return null;
}

const activityPath = findMainActivity(sourceRoot);
if (!activityPath) throw new Error('Capacitor MainActivity.java was not found');
const activity = readFileSync(activityPath, 'utf8');
const packageMatch = activity.match(/^package\\s+([\\w.]+);/m);
if (!packageMatch) throw new Error('Cannot determine the generated Android package name');
const packageName = packageMatch[1];
const packagePath = join(sourceRoot, ...packageName.split('.'));
mkdirSync(packagePath, { recursive: true });

const pluginSource =
  'package ' + packageName + ';\\n\\n' +
  'import android.content.ContentValues;\\n' +
  'import android.net.Uri;\\n' +
  'import android.os.Build;\\n' +
  'import android.os.Environment;\\n' +
  'import android.provider.MediaStore;\\n' +
  'import android.util.Base64;\\n' +
  'import com.getcapacitor.JSObject;\\n' +
  'import com.getcapacitor.Plugin;\\n' +
  'import com.getcapacitor.PluginCall;\\n' +
  'import com.getcapacitor.PluginMethod;\\n' +
  'import com.getcapacitor.annotation.CapacitorPlugin;\\n' +
  'import java.io.File;\\n' +
  'import java.io.FileOutputStream;\\n' +
  'import java.io.OutputStream;\\n\\n' +
  '@CapacitorPlugin(name = "KoptilnyaDownloads")\\n' +
  'public class KoptilnyaDownloadsPlugin extends Plugin {\\n' +
  '  @PluginMethod\\n' +
  '  public void saveToDownloads(PluginCall call) {\\n' +
  '    String fileName = call.getString("fileName");\\n' +
  '    String mimeType = call.getString("mimeType");\\n' +
  '    String encodedData = call.getString("data");\\n' +
  '    if (fileName == null || fileName.trim().isEmpty() || encodedData == null) {\\n' +
  '      call.reject("Не указаны имя или содержимое файла");\\n' +
  '      return;\\n' +
  '    }\\n' +
  '    if (mimeType == null || mimeType.trim().isEmpty()) mimeType = "application/octet-stream";\\n' +
  '    try {\\n' +
  '      byte[] bytes = Base64.decode(encodedData, Base64.DEFAULT);\\n' +
  '      JSObject result = new JSObject();\\n' +
  '      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {\\n' +
  '        ContentValues values = new ContentValues();\\n' +
  '        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);\\n' +
  '        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);\\n' +
  '        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Коптильня");\\n' +
  '        values.put(MediaStore.MediaColumns.IS_PENDING, 1);\\n' +
  '        Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);\\n' +
  '        if (uri == null) throw new IllegalStateException("Android не создал файл в Загрузках");\\n' +
  '        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {\\n' +
  '          if (output == null) throw new IllegalStateException("Не удалось открыть файл в Загрузках");\\n' +
  '          output.write(bytes);\\n' +
  '        }\\n' +
  '        ContentValues ready = new ContentValues();\\n' +
  '        ready.put(MediaStore.MediaColumns.IS_PENDING, 0);\\n' +
  '        getContext().getContentResolver().update(uri, ready, null, null);\\n' +
  '        result.put("uri", uri.toString());\\n' +
  '        result.put("path", "Download/Коптильня/" + fileName);\\n' +
  '      } else {\\n' +
  '        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);\\n' +
  '        if (base == null) throw new IllegalStateException("Папка загрузок недоступна");\\n' +
  '        File folder = new File(base, "Коптильня");\\n' +
  '        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Не удалось создать папку");\\n' +
  '        File outputFile = new File(folder, fileName);\\n' +
  '        try (FileOutputStream output = new FileOutputStream(outputFile)) { output.write(bytes); }\\n' +
  '        result.put("uri", Uri.fromFile(outputFile).toString());\\n' +
  '        result.put("path", outputFile.getAbsolutePath());\\n' +
  '      }\\n' +
  '      result.put("fileName", fileName);\\n' +
  '      call.resolve(result);\\n' +
  '    } catch (Exception error) {\\n' +
  '      call.reject("Не удалось сохранить файл в Загрузки/Коптильня", error);\\n' +
  '    }\\n' +
  '  }\\n' +
  '}\\n';

writeFileSync(join(packagePath, 'KoptilnyaDownloadsPlugin.java'), pluginSource, 'utf8');

const mainActivity =
  'package ' + packageName + ';\\n\\n' +
  'import android.os.Bundle;\\n' +
  'import com.getcapacitor.BridgeActivity;\\n\\n' +
  'public class MainActivity extends BridgeActivity {\\n' +
  '  @Override\\n' +
  '  public void onCreate(Bundle savedInstanceState) {\\n' +
  '    registerPlugin(KoptilnyaDownloadsPlugin.class);\\n' +
  '    super.onCreate(savedInstanceState);\\n' +
  '  }\\n' +
  '}\\n';
writeFileSync(activityPath, mainActivity, 'utf8');
console.log('Registered KoptilnyaDownloadsPlugin; exports will be saved into Downloads/Коптильня on Android 10+.');
