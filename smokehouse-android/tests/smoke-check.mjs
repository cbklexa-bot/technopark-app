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

const inlineScripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
assert.ok(inlineScripts.length >= 2, 'The inline theme and application scripts must exist');
for (const [index, inlineScript] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new Function(inlineScript[1]), 'Inline JavaScript block ' + (index + 1) + ' must parse');
}

const requiredUi = [
  'id="page-products"', 'id="productsGrid"', 'id="page-production"', 'id="page-clients"',
  'id="page-documents"', 'id="page-expenses"', 'id="page-debts"',
  'id="page-reports"', 'id="page-recipes"', 'id="page-settings"', 'id="pageBack"',
  'id="page-services"', 'id="page-payments"', 'id="serviceDocsTable"', 'id="paymentsTable"', 'id="recipesGrid"', 'id="servicePresetManager"', 'id="licenseSettingsBtn"', 'id="importExcelBtn"', 'id="exportExcelBtn"',
  'id="exportFullBackup"', 'id="restoreFullBackup"', 'id="clientSearchInput"',
  'id="clientStatsPeriod"', 'id="reportStart"', 'id="reportEnd"',
];
for (const marker of requiredUi) assert.ok(html.includes(marker), 'Missing UI marker: ' + marker);
assert.ok(html.includes("applyTheme('light')"), 'The app must use a single forced light theme');
assert.ok(!html.includes('id="themeSelect"'), 'Theme selector must not be present');
assert.ok(!html.includes('id="exportClientsCsv"') && !html.includes('id="csv"'), 'Legacy CSV export buttons must not be visible in Settings');
assert.ok(html.includes('Полная история: ') && html.includes('Оплачено') && html.includes('Долг'), 'CRM history must show full invoice and payment details');
assert.ok(html.includes('Поиск клиента по номеру телефона'), 'CRM search must explicitly support phone number lookup');
assert.ok(html.includes('optional=name===\'note\''), 'Comment fields marked optional must not be required');
assert.ok(html.includes('id="menuToggle"') && html.includes("button.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();go(button.dataset.page)})"), 'Sidebar, bottom navigation and quick action routes must navigate directly');
assert.ok(html.includes('name="servicePresetId"') && html.includes("if(t==='servicePreset')") && html.includes('data-edit-service-preset='), 'Service presets must be managed from Settings and saved locally');
assert.ok(!html.includes('name="customerName"'), 'Service form must not ask for customer name');
assert.ok(!html.includes('name="receiptPrice"'), 'Stock receipt must not ask for a separate incoming price');
assert.ok(html.includes("document.documentElement.dataset.theme='light'"), 'Light theme must be applied without a theme selector');

const requiredBusinessLogic = [
  "type==='receipt'", "type==='sale'", "type==='service'",
  "type==='payment'", 'function resolveServiceClient', 'function deleteClient', 'data-delete-product', 'data-delete-expense',
  'function renderReports', 'function docStockDelta', "localStorage.getItem(KEY)",
  "document.getElementById('exportFullBackup').onclick",
  "document.getElementById('backupFile').onchange",
  "document.getElementById('pageBack').onclick",
  'data-delete-doc=',
  'function openCostCalculator',
  'id="chooseProductPhoto"',
  'id="productPhotoPreview"',
  'photoChoose.onclick=async function()',
  'photoInput.onchange=async function()',
  'function addReceiptLine(item)',
  'Стоимость прихода:',
  'function applyTheme(theme)',
  'function nextDocNumber(prefix)',
  'id="servicePresetManager"',
  'id="recipesGrid"',
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
assert.ok(html.includes("applyTheme('light')"), 'The app must force one light theme');
assert.ok(!html.includes('id="themeSelect"'), 'Theme selection must not be exposed in Settings');
assert.ok(html.includes('Комментарий (необязательно)'), 'Expense/service comment must be optional');
const homeStart = html.indexOf('<section id="page-home"');
const homeEnd = html.indexOf('</section>', homeStart);
assert.notEqual(homeStart, -1, 'Home section must exist');
const homeMarkup = html.slice(homeStart, homeEnd);
assert.equal((homeMarkup.match(/class="quick"/g) || []).length, 6, 'Home must contain exactly six quick actions');
assert.ok(homeMarkup.includes('class="finance-panel"') && homeMarkup.includes('id="metrics"'), 'Monthly metrics must be grouped inside one finance panel');
const sidebarStart = html.indexOf('<nav class="nav">');
const sidebarEnd = html.indexOf('</nav>', sidebarStart);
assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, 'Sidebar navigation must exist');
const sidebarMarkup = html.slice(sidebarStart, sidebarEnd);
for (const page of ['home','products','documents','services','clients','expenses','debts','reports','settings']) {
  assert.ok(sidebarMarkup.includes('data-page="' + page + '"'), 'Required sidebar item missing: ' + page);
}
for (const page of ['production','payments','recipes']) {
  assert.ok(!sidebarMarkup.includes('data-page="' + page + '"'), 'Unrequested sidebar item must be removed: ' + page);
}
for (const page of ['products','documents','production','services','clients','expenses','debts','payments','reports','recipes','settings']) {
  assert.ok(html.includes('id="page-' + page + '"'), 'Application section missing: ' + page);
}
assert.ok(!html.includes('История оплат</button>'), 'Separate payment history shortcut must not appear in debts');
assert.ok(homeMarkup.includes('<b>Продукция</b>') && homeMarkup.includes('<b>Документы</b>') && homeMarkup.includes('<b>Затраты</b>'), 'Dashboard must expose product catalog, documents, and expenses');
assert.ok(homeMarkup.includes('data-action="service"') && homeMarkup.includes('<b>Услуга по сырью клиента</b>'), 'Dashboard must provide a shortcut to client-raw-material service');
assert.ok(homeMarkup.includes('data-action="receipt"') && homeMarkup.includes('<b>Новый приход</b>'), 'Dashboard must provide a new receipt shortcut');
assert.ok(homeMarkup.includes('data-action="sale"') && homeMarkup.includes('<b>Новый расход</b>'), 'Dashboard must provide a new stock-out/sale shortcut');
assert.ok(html.includes("metric('Выручка',money(monthRevenue)") && html.includes("metric('Долги клиентов',money(monthDebts)") && html.includes("metric('Затраты',money(monthExpenses)") && html.includes("metric('Чистая прибыль',money(monthProfit)"), 'Dashboard must show exactly the four requested monthly finance metrics');
assert.ok(html.includes('Цена переработки за 1 кг, ₽') && html.includes('Себестоимость переработки за 1 кг, ₽'), 'Service template prices must be clearly per kilogram');
assert.ok(html.includes('<button class="btn" type="submit">Сохранить</button>'), 'Forms must use an explicit submit button');
assert.ok(html.includes('Не удалось сохранить: '), 'Form submission errors must be visible to the user');
assert.ok(html.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important') && html.includes('grid-template-rows:repeat(2,minmax(82px,1fr))') && html.includes('flex:1 1 50%'), 'Dashboard finance metrics must occupy roughly half the phone screen in a 2x2 grid');
assert.ok(html.includes('class="home-actions"') && html.includes('grid-template-rows:repeat(3,minmax(72px,1fr))') && html.includes('min-height:72px;height:100%'), 'Six larger quick actions must fill the lower part of the phone screen');
assert.ok(html.includes('Local cache unavailable; trying native SQLite persistence') && html.includes("typeof window.KoptilnyaNative.saveBusinessState!=='function'") && html.includes('Не удалось сохранить данные в SQLite'), 'A full WebView cache must trigger direct native SQLite persistence and report native save errors');
assert.ok(html.includes('var saveResult=save();if(saveResult&&typeof saveResult.then===\'function\')'), 'Form submission must wait for native fallback persistence before closing the form');
assert.ok(html.includes('businessForm.noValidate=true') && html.includes("f.querySelector(':invalid')") && html.includes("submitButton.textContent='Сохранение…'") && html.includes('6500'), 'Form submissions must validate fields visibly, show saving state, and keep errors visible longer');
assert.ok(html.includes("f.dataset.saving='false'") && html.includes("Не удалось сохранить: "), 'Form state and errors must be restored/reported on failure');
assert.ok(html.includes('id="serviceDocsTable"'), 'Service history screen must be present');
assert.ok(html.includes('id="paymentsTable"') && html.includes('data-edit-payment='), 'Payment history must remain visible and editable');
assert.ok(html.includes('data-edit-service-preset=') && html.includes('data-delete-service-preset='), 'Service templates must be managed in Settings');
assert.ok(html.includes('data-edit-recipe=') && html.includes('data-delete-recipe='), 'Recipes must support editing and deletion');
const serviceFormStart = html.indexOf("}else if(type==='service'){", html.indexOf('function open(type,extra)'));
const serviceFormEnd = html.indexOf("}else if(type==='receipt'){", serviceFormStart);
assert.ok(serviceFormStart >= 0 && serviceFormEnd > serviceFormStart, 'Client raw-material service form must exist');
const serviceFormMarkup = html.slice(serviceFormStart, serviceFormEnd);
assert.ok(serviceFormMarkup.includes('Принято сырья, кг') && serviceFormMarkup.includes('Номер телефона клиента (необязательно)'), 'Service form must include weight and optional phone');
assert.ok(!serviceFormMarkup.includes('servicePresetPrice') && !serviceFormMarkup.includes('newServicePreset') && !serviceFormMarkup.includes("inp('price'") && !serviceFormMarkup.includes("inp('cost'"), 'Service form must not expose template maintenance or manual price/cost fields');
assert.ok(html.includes("nextDocNumber('НК')") && html.includes("nextDocNumber('ПР')") && html.includes("nextDocNumber('УС')"), 'Document numbers must be generated automatically');
assert.equal(html.split('<section').length - 1, html.split('</section>').length - 1, 'HTML sections must be balanced');
assert.equal(html.split('<nav').length - 1, html.split('</nav>').length - 1, 'HTML navigation elements must be balanced');
console.log('Smoke check passed: compact dashboard, navigation routes, service-template separation, recipes CRUD, local accounting, Android exports, ZIP restore, and Excel sheets are present.');
