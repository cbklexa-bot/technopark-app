import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../www/excel-import.js';

const root = process.cwd();
const html = readFileSync(join(root, 'www', 'index.html'), 'utf8');
const bridge = readFileSync(join(root, 'www', 'native-bridge.js'), 'utf8');
const localBackend = readFileSync(join(root, 'www', 'local-backend.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, 'The main application script must exist');
assert.doesNotThrow(() => new Function(inlineScript[1]), 'The main application JavaScript must parse');

const requiredUi = [
  'id="page-products"', 'id="productsGrid"', 'id="page-production"', 'id="page-clients"',
  'id="page-documents"', 'id="page-expenses"', 'id="page-debts"',
  'id="page-reports"', 'id="page-recipes"', 'id="page-settings"', 'id="pageBack"',
  'id="themeSelect"', 'id="licenseSettingsBtn"', 'id="importExcelBtn"', 'id="exportExcelBtn"',
  'id="exportFullBackup"', 'id="restoreFullBackup"', 'id="clientSearchInput"',
  'id="clientStatsPeriod"', 'id="reportStart"', 'id="reportEnd"',
];
for (const marker of requiredUi) assert.ok(html.includes(marker), 'Missing UI marker: ' + marker);
assert.ok(html.includes('value="smokehouse"'), 'Smokehouse theme must be available');
assert.ok(html.includes('@keyframes koptilnyaSmokeDrift'), 'Smokehouse theme must include subtle animated smoke');
assert.ok(!html.includes('id="exportClientsCsv"') && !html.includes('id="csv"'), 'Legacy CSV export buttons must not be visible in Settings');
assert.ok(html.includes('Полная история: ') && html.includes('Оплачено') && html.includes('Долг'), 'CRM history must show full invoice and payment details');
assert.ok(html.includes('Поиск клиента по номеру телефона'), 'CRM search must explicitly support phone number lookup');
assert.ok(html.includes('optional=name===\'note\''), 'Comment fields marked optional must not be required');
assert.ok(html.includes('return \'\'') && html.includes('Без привязки к клиенту — контакты необязательны'), 'Smokehouse services must be saveable without customer name or phone');

const requiredBusinessLogic = [
  "type==='receipt'", "type==='sale'", "type==='service'",
  "type==='payment'", 'function resolveServiceClient', 'function deleteClient', 'data-delete-product', 'data-delete-expense',
  'function renderReports', 'function docStockDelta', "localStorage.getItem(KEY)",
  "document.getElementById('exportFullBackup').onclick",
  "document.getElementById('backupFile').onchange",
  "document.getElementById('themeSelect').onchange",
  "document.getElementById('pageBack').onclick",
  'data-delete-doc=',
  'function openCostCalculator',
  'id="chooseProductPhoto"',
  'id="productPhotoPreview"',
  'photoChoose.onclick=async function()',
  'photoInput.onchange=async function()',
];
for (const marker of requiredBusinessLogic) assert.ok(html.includes(marker), 'Missing business logic: ' + marker);
assert.ok(localBackend.includes('showImportExcel: () => openImportPicker()'), 'Settings import action must open Excel import');
assert.ok(!localBackend.includes("bar.innerHTML = '<span"), 'Floating import/license bar should not be recreated');


const requiredArchiveLogic = [
  'exportFullArchive', 'exportExcel', 'pickImage', 'readBackupFile', 'JSZip.loadAsync',
  'reports/koptilnya-financial-reports.xlsx', 'data/database.json',
  'photos/products/', 'attachments/', "addWorksheet(workbook,'Сводка'",
  "addWorksheet(workbook,'Продукция'", "addWorksheet(workbook,'Клиенты'",
  "addWorksheet(workbook,'Документы'", "addWorksheet(workbook,'Позиции'",
  "addWorksheet(workbook,'Затраты'", "addWorksheet(workbook,'Оплаты'",
  "addWorksheet(workbook,'Партии'", "addWorksheet(workbook,'Рецепты'",
  "addWorksheet(workbook,'Продажи'", "addWorksheet(workbook,'Услуги'",
  "addWorksheet(workbook,'По месяцам'", "addWorksheet(workbook,'Файлы'",
  'KoptilnyaDownloads.saveToDownloads', "'application/zip'", 'utf8ToBase64',
];
for (const marker of requiredArchiveLogic) assert.ok(bridge.includes(marker), 'Missing archive logic: ' + marker);

assert.equal(config.appId, 'ru.koptilnya.app', 'Android app ID changed unexpectedly');
assert.equal(config.appName, 'Коптильня', 'Android app label changed unexpectedly');
assert.equal(config.webDir, 'dist', 'Capacitor webDir must match Vite output');
assert.ok(pkg.dependencies['@capacitor/android'], 'Capacitor Android dependency missing');
assert.ok(!pkg.dependencies['@capacitor/app'], 'Removed auth integration must not retain Capacitor App dependency');
assert.ok(!pkg.dependencies['@supabase/supabase-js'], 'Offline APK must not include Supabase client dependency');
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
  assert.equal(typeof nativeApi.exportExcel, 'function', 'Excel export API must be registered');
  assert.equal(typeof nativeApi.pickImage, 'function', 'Native image picker API must be registered');
  assert.equal(await nativeApi.pickImage(), null, 'Browser-mode image picker should fall back to the file input');

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

  const excelFileName = await nativeApi.exportExcel(sampleState);
  assert.ok(excelFileName.startsWith('koptilnya-data-') && excelFileName.endsWith('.xlsx'), 'Excel export filename must use .xlsx');
  assert.ok(downloadedBlob, 'Excel export must produce a downloadable workbook');
  const exportedWorkbook = XLSX.read(Buffer.from(await downloadedBlob.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(exportedWorkbook.SheetNames, ['Продукция','Клиенты','Документы','Позиции','Затраты','Оплаты','Партии']);
  const productRows = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets['Продукция'], { header: 1 });
  assert.equal(productRows[1][1], 'Грудинка копчёная');
  const clientRows = XLSX.utils.sheet_to_json(exportedWorkbook.Sheets['Клиенты'], { header: 1 });
  assert.equal(clientRows[1][1], 'Тестовый клиент');
  const roundTrip = parseWorkbook(exportedWorkbook, excelFileName);
  assert.equal(roundTrip.summary.counts.products, sampleState.products.length, 'Excel export should re-import all product cards');
  assert.equal(roundTrip.summary.counts.clients, sampleState.clients.length, 'Excel export should re-import all client cards');
  assert.equal(roundTrip.summary.counts.documents, sampleState.docs.length, 'Excel export should re-import itemized and service documents');
  assert.equal(roundTrip.summary.counts.expenses, sampleState.expenses.length, 'Excel export should re-import expenses');
  assert.equal(roundTrip.summary.counts.payments, sampleState.payments.length, 'Excel export should re-import payments and allocation links');
  assert.equal(roundTrip.summary.counts.batches, sampleState.batches.length, 'Excel export should re-import production batches');
  console.log('Runtime Excel round-trip passed: products, clients, documents, expenses, payments and production batches.');

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
const installer = readFileSync(join(root, 'scripts', 'install-download-plugin.mjs'), 'utf8');
for (const marker of ['MediaStore.Downloads.EXTERNAL_CONTENT_URI','MediaStore.MediaColumns.RELATIVE_PATH','registerPlugin(KoptilnyaDownloadsPlugin.class)','Environment.DIRECTORY_DOWNLOADS','getLicenseIdentity','getTrialState','saveTrialState','pickImage','ACTION_OPEN_DOCUMENT','ActivityCallback','Settings.Secure.ANDROID_ID','SharedPreferences']) {
  assert.ok(installer.includes(marker), 'Missing direct Downloads / offline license implementation: ' + marker);
}
assert.ok(!installer.includes('android.intent.action.VIEW'), 'Removed auth integration must not configure a deep link');
assert.ok(html.includes('name="category" list="expenseCategoryOptions"'), 'Expense category must be free text with suggestions');
assert.ok(!html.includes('<b>ДЕМО-РЕЖИМ</b>'), 'Demo mode warning should not appear in the product UI');
assert.ok(!html.includes('<label>Поставщик</label>'), 'Receipt form should not require a supplier');
assert.ok(!html.includes("sel('type','Тип'"), 'Product type selector should be removed');
assert.ok(!html.includes('id="exportClientsCsv">Экспорт базы CSV'), 'Client CSV export belongs in Settings, not the client screen');
assert.ok(!html.includes('<button class="btn secondary" id="csv">Экспорт CSV</button>'), 'Report export should be inside Settings, not the reports header');
assert.ok(html.includes('Услуга по копчению'), 'Smoking-service wording missing');
assert.ok(html.includes('Чистая прибыль'), 'Monthly net profit metric missing');
assert.ok(html.includes('applyTheme(localStorage.getItem'), 'Persisted theme setting missing');
assert.ok(html.includes('Комментарий (необязательно)'), 'Expense comment must be optional');
const recipeStart = html.indexOf('<section id="page-recipes"');
assert.notEqual(recipeStart, -1, 'Recipe placeholder should remain in navigation');
const recipeEnd = html.indexOf('</section>', recipeStart);
assert.notEqual(recipeEnd, -1, 'Recipe placeholder section must be closed');
const recipeMarkup = html.slice(recipeStart, recipeEnd);
assert.ok(recipeMarkup.includes('Скоро'), 'Recipe module must display a Coming Soon placeholder');
assert.ok(!recipeMarkup.includes('data-action=') && !recipeMarkup.includes('ownerModeToggle') && !recipeMarkup.includes('addRecipeButton'),
  'Recipe placeholder must not expose editable controls');
for (const disabledMarker of ['OWNER_PIN', 'ownerModeToggle', 'addRecipeButton', 'data-edit-recipe=', 'data-delete-recipe=']) {
  assert.ok(!html.includes(disabledMarker), 'Unfinished recipe functionality must be disabled: ' + disabledMarker);
}
console.log('Smoke check passed: source syntax, primary accounting modules, Android file export, ZIP restore, and 13 Excel sheets are present.');
