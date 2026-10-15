import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const root = process.cwd();
const html = readFileSync(join(root, 'www', 'index.html'), 'utf8');
const bridge = readFileSync(join(root, 'www', 'native-bridge.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, 'The main application script must exist');
assert.doesNotThrow(() => new Function(inlineScript[1]), 'The main application JavaScript must parse');

const requiredUi = [
  'id="page-products"', 'id="page-production"', 'id="page-clients"',
  'id="page-documents"', 'id="page-expenses"', 'id="page-debts"',
  'id="page-reports"', 'id="page-recipes"', 'id="exportFullBackup"',
  'id="restoreFullBackup"', 'id="exportClientsCsv"', 'id="clientSearchInput"',
  'id="clientStatsPeriod"', 'id="reportStart"', 'id="reportEnd"',
];
for (const marker of requiredUi) assert.ok(html.includes(marker), 'Missing UI marker: ' + marker);

const requiredBusinessLogic = [
  "type==='receipt'", "type==='sale'", "type==='service'",
  "type==='payment'", 'function resolveServiceClient', 'function deleteClient',
  'function renderReports', 'function docStockDelta', "localStorage.getItem(KEY)",
  "document.getElementById('exportFullBackup').onclick",
  "document.getElementById('backupFile').onchange",
];
for (const marker of requiredBusinessLogic) assert.ok(html.includes(marker), 'Missing business logic: ' + marker);

const requiredArchiveLogic = [
  'exportFullArchive', 'readBackupFile', 'JSZip.loadAsync',
  'reports/koptilnya-financial-reports.xlsx', 'data/database.json',
  'photos/products/', 'attachments/', "addWorksheet(workbook,'Сводка'",
  "addWorksheet(workbook,'Продукция'", "addWorksheet(workbook,'Клиенты'",
  "addWorksheet(workbook,'Документы'", "addWorksheet(workbook,'Позиции'",
  "addWorksheet(workbook,'Затраты'", "addWorksheet(workbook,'Оплаты'",
  "addWorksheet(workbook,'Партии'", "addWorksheet(workbook,'Рецепты'",
  "addWorksheet(workbook,'Продажи'", "addWorksheet(workbook,'Услуги'",
  "addWorksheet(workbook,'По месяцам'", "addWorksheet(workbook,'Файлы'",
  'Share.share', 'Directory.Cache',
];
for (const marker of requiredArchiveLogic) assert.ok(bridge.includes(marker), 'Missing archive logic: ' + marker);

assert.equal(config.appId, 'ru.koptilnya.app', 'Android app ID changed unexpectedly');
assert.equal(config.appName, 'Коптильня', 'Android app label changed unexpectedly');
assert.equal(config.webDir, 'dist', 'Capacitor webDir must match Vite output');
assert.ok(pkg.dependencies['@capacitor/android'], 'Capacitor Android dependency missing');
assert.ok(pkg.dependencies['@capacitor/filesystem'], 'Native file export dependency missing');
assert.ok(pkg.dependencies['@capacitor/share'], 'Native share dependency missing');
assert.ok(pkg.dependencies.jszip, 'ZIP dependency missing');
assert.ok(pkg.dependencies.xlsx, 'Excel dependency missing');
assert.ok(pkg.devDependencies['@capacitor/assets'], 'Branded Android icon generator missing');


const createdUrls = new Map();
let downloadedBlob = null;
let urlCounter = 0;
const savedCreateObjectUrl = URL.createObjectURL;
const savedRevokeObjectUrl = URL.revokeObjectURL;
URL.createObjectURL = (blob) => {
  const url = 'blob:koptilnya-test-' + (++urlCounter);
  createdUrls.set(url, blob);
  return url;
};
URL.revokeObjectURL = () => {};
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
globalThis.window = { Capacitor: { platform: 'web' }, dispatchEvent() {} };
globalThis.document = {
  body: { appendChild() {} },
  createElement(tag) {
    assert.equal(tag, 'a');
    return {
      href: '',
      download: '',
      click() { downloadedBlob = createdUrls.get(this.href) || null; },
      remove() {},
    };
  },
};

try {
  await import(new URL('../www/native-bridge.js?archive-smoke-test=1', import.meta.url));
  const nativeApi = globalThis.window.KoptilnyaNative;
  assert.ok(nativeApi, 'Native bridge must register its export interface');
  assert.equal(nativeApi.isNative, false, 'Node test should exercise web export path');

  const photoData = 'data:image/png;base64,iVBORw0KGgo=';
  const attachmentData = 'data:application/pdf;base64,JVBERi0xLjQK';
  const sampleState = {
    products: [
      { id: 'p1', name: 'Грудинка копчёная', type: 'Готовая продукция', stock: 3, cost: 120, receipt: 180, sale: 250, unit: 'кг', image: photoData },
      { id: 'svc1', name: 'Копчение сырья клиента', type: 'Услуга', stock: 0, cost: 20, receipt: 20, sale: 150, unit: 'кг', image: '' },
    ],
    clients: [{ id: 'c1', name: 'Тестовый клиент', phone: '+7 900 000-00-00', kind: 'Частный клиент' }],
    docs: [
      { id: 'd1', number: 'НК-TEST', date: '2026-10-01', type: 'sale', clientId: 'c1', items: [{ productId: 'p1', qty: 2, price: 250, cost: 120 }], productId: 'p1', qty: 2, price: 250, cost: 120, paid: 500, attachments: [{ name: 'накладная.pdf', type: 'application/pdf', data: attachmentData }], note: 'Тестовая продажа' },
      { id: 'd2', number: 'УС-TEST', date: '2026-10-02', type: 'service', clientId: 'c1', productId: 'svc1', qty: 1.5, price: 150, cost: 20, paid: 0, note: 'Тестовая услуга', attachments: [] },
      { id: 'd3', number: 'ПР-TEST', date: '2026-10-01', type: 'receipt', supplier: 'Тестовый поставщик', productId: 'p1', qty: 4, price: 180, cost: 120, paid: 0, note: 'Тестовый приход', attachments: [] },
    ],
    expenses: [{ id: 'e1', date: '2026-10-01', category: 'Электричество', note: 'Тест', amount: 35, inCost: false }],
    payments: [{ id: 'pay1', date: '2026-10-01', clientId: 'c1', amount: 500, method: 'Перевод', allocations: [{ docId: 'd1', amount: 500 }] }],
    batches: [{ id: 'b1', date: '2026-10-01', productId: 'p1', rawName: 'Грудинка сырая', rawQty: 3, outputQty: 2, totalCost: 240 }],
    recipes: [{ id: 'r1', name: 'Рецепт тест', kind: 'Копчение', emoji: '🥩', desc: 'Проверка архива' }],
  };
  const backup = { format: 'koptilnya-backup', version: 2, exportedAt: '2026-10-16T10:00:00.000Z', application: 'Коптильня', contents: sampleState };
  const filename = await nativeApi.exportFullArchive(backup);
  assert.match(filename, /^koptilnya-archive-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.ok(downloadedBlob, 'Export must produce a downloadable ZIP Blob');

  const zipBuffer = Buffer.from(await downloadedBlob.arrayBuffer());
  const zip = await JSZip.loadAsync(zipBuffer);
  const archivePaths = Object.keys(zip.files);
  for (const path of ['data/database.json','reports/koptilnya-financial-reports.xlsx','manifest.json','README.txt']) {
    assert.ok(zip.file(path), 'ZIP missing required file: ' + path);
  }
  const db = JSON.parse(await zip.file('data/database.json').async('text'));
  assert.ok(db.contents.products[0].imageArchivePath, 'Product image must be stored outside the JSON');
  assert.ok(db.contents.docs[0].attachments[0].archivePath, 'Document attachment must be stored outside the JSON');
  assert.ok(zip.file(db.contents.products[0].imageArchivePath), 'Product image file must exist in ZIP');
  assert.ok(zip.file(db.contents.docs[0].attachments[0].archivePath), 'Document attachment must exist in ZIP');

  const workbookBytes = await zip.file('reports/koptilnya-financial-reports.xlsx').async('nodebuffer');
  const workbook = XLSX.read(workbookBytes, { type: 'buffer' });
  const expectedSheets = ['Сводка','Продукция','Клиенты','Документы','Позиции','Затраты','Оплаты','Партии','Рецепты','Продажи','Услуги','По месяцам','Файлы'];
  assert.deepEqual(workbook.SheetNames, expectedSheets, 'Excel workbook must include all 13 expected sheets');

  const fileForRestore = Buffer.from(zipBuffer);
  fileForRestore.name = 'koptilnya-backup-test.zip';
  const restored = await nativeApi.readBackupFile(fileForRestore);
  assert.equal(restored.format, 'koptilnya-backup');
  assert.equal(restored.version, 2);
  assert.equal(restored.contents.products[0].image, photoData, 'Restored product photo must be reconstructed');
  assert.equal(restored.contents.docs[0].attachments[0].data, attachmentData, 'Restored document attachment must be reconstructed');
  assert.equal(restored.contents.docs.length, 3);
  console.log('Runtime archive test passed: ZIP, JSON database, product photo, document attachment, 13-sheet Excel workbook, and ZIP restore.');
} finally {
  URL.createObjectURL = savedCreateObjectUrl;
  URL.revokeObjectURL = savedRevokeObjectUrl;
}

const assetGenerator = readFileSync(join(root, 'scripts', 'generate_assets.py'), 'utf8');
for (const marker of ['icon-only.png','icon-foreground.png','icon-background.png','splash.png','splash-dark.png']) assert.ok(assetGenerator.includes(marker), 'Missing branded Android asset: ' + marker);
console.log('Smoke check passed: source syntax, primary accounting modules, Android file export, ZIP restore, and 13 Excel sheets are present.');
