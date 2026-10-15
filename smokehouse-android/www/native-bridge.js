import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const isNative = Capacitor.isNativePlatform();

function safeFilename(value) {
  return String(value || 'koptilnya-export.json')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 150) || 'koptilnya-export.json';
}

async function saveTextFile(filename, mimeType, content) {
  if (!isNative) {
    throw new Error('Нативный экспорт доступен только в Android-приложении.');
  }

  const safeName = safeFilename(filename);
  const file = await Filesystem.writeFile({
    path: 'koptilnya-' + safeName,
    data: String(content),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  await Share.share({
    title: safeName,
    text: 'Файл экспорта из приложения «Коптильня» (' + (mimeType || 'application/octet-stream') + ')',
    files: [file.uri],
    dialogTitle: 'Сохранить или передать файл',
  });

  return { uri: file.uri, filename: safeName };
}

window.KoptilnyaNative = {
  isNative,
  saveTextFile,
};

window.dispatchEvent(new CustomEvent('koptilnya-native-ready'));
