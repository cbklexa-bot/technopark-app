import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

console.log('Smoke check passed: source syntax, primary accounting modules, Android file export, ZIP restore, and 13 Excel sheets are present.');
