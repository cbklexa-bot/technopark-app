import { Capacitor, registerPlugin } from '@capacitor/core';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const isNative = Capacitor.isNativePlatform();
const KoptilnyaDownloads = registerPlugin('KoptilnyaDownloads');

function safeFilename(value) {
  return String(value || 'koptilnya-export')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 110) || 'koptilnya-export';
}
function num(value) { return Number(value) || 0; }
function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function str(value) { return value == null ? '' : String(value); }
function docItems(doc) {
  if (Array.isArray(doc.items) && doc.items.length) return doc.items;
  return [{ productId: doc.productId, qty: doc.qty, price: doc.price, cost: doc.cost, note: doc.note }];
}
function docAmount(doc) {
  if (doc && doc.manualAmount != null && doc.manualAmount !== '') return num(doc.manualAmount);
  return docItems(doc).reduce((sum, item) => sum + num(item.qty) * num(item.price), 0);
}
function docCost(doc) {
  if (doc && doc.manualCost != null && doc.manualCost !== '') return num(doc.manualCost);
  return docItems(doc).reduce((sum, item) => sum + num(item.qty) * num(item.cost), 0);
}
function getProduct(state, id) { return (state.products || []).find((p) => p.id === id) || {}; }
function getClient(state, id) { return (state.clients || []).find((c) => c.id === id) || {}; }
function docTypeLabel(type) {
  return ({ sale: 'Расходный', receipt: 'Приходный', service: 'Услуга' })[type] || str(type);
}
function qty(doc) { return docItems(doc).reduce((sum, item) => sum + num(item.qty), 0); }
function mimeDetails(dataUri) {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) return null;
  const comma = dataUri.indexOf(',');
  if (comma < 0) return null;
  const header = dataUri.slice(5, comma);
  if (!/;base64/i.test(header)) return null;
  const mime = (header.split(';')[0] || 'application/octet-stream').toLowerCase();
  const ext = ({
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
    'application/pdf': 'pdf', 'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls'
  })[mime] || 'bin';
  return { mime, ext, base64: dataUri.slice(comma + 1) };
}
function mimeFromPath(path) {
  const ext = (String(path).split('.').pop() || '').toLowerCase();
  return ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',pdf:'application/pdf',txt:'text/plain',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',doc:'application/msword',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel'})[ext] || 'application/octet-stream';
}
function addWorksheet(workbook, name, rows) {
  const safeRows = rows.length ? rows : [['Нет данных']];
  const sheet = XLSX.utils.aoa_to_sheet(safeRows);
  const columns = Math.max(...safeRows.map((row) => row.length), 1);
  sheet['!cols'] = Array.from({length: columns}, (_, col) => {
    let max = 10;
    safeRows.forEach((row) => { max = Math.max(max, str(row[col]).length); });
    return { wch: Math.min(max + 2, 48) };
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}
function moneySummary(state) {
  const operational = (state.docs || []).filter((d) => d.type === 'sale' || d.type === 'service');
  const revenue = operational.reduce((sum, d) => sum + docAmount(d), 0);
  const costs = operational.reduce((sum, d) => sum + docCost(d), 0);
  const expenses = state.expenses || [];
  const totalExpenses = expenses.reduce((sum, e) => sum + num(e.amount), 0);
  const included = expenses.filter((e) => e.inCost).reduce((sum, e) => sum + num(e.amount), 0);
  const extra = expenses.filter((e) => !e.inCost).reduce((sum, e) => sum + num(e.amount), 0);
  const debt = operational.reduce((sum, d) => sum + Math.max(0, docAmount(d) - num(d.paid)), 0);
  return { operational, revenue, costs, totalExpenses, included, extra, debt, profit: revenue - costs - extra };
}
async function saveBase64ToDownloads(filename, base64, mimeType) {
  if (!isNative) {
    downloadBlob(filename, base64ToBlob(base64, mimeType || 'application/octet-stream'));
    return filename;
  }
  await KoptilnyaDownloads.saveToDownloads({
    fileName: safeFilename(filename),
    mimeType: mimeType || 'application/octet-stream',
    data: base64,
  });
  return filename;
}
function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportFullArchive(backup) {
  const state = JSON.parse(JSON.stringify(backup.contents || {}));
  const archive = new JSZip();
  const media = [];
  const dateTag = new Date().toISOString().slice(0, 10);
  const products = state.products || [];
  const clients = state.clients || [];
  const docs = state.docs || [];
  const expenses = state.expenses || [];
  const payments = state.payments || [];
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const docById = new Map(docs.map((doc) => [doc.id, doc]));
  const productTotals = new Map();
  const serviceTotals = new Map();
  const monthly = new Map();

  products.forEach((product, index) => {
    const info = mimeDetails(product.image);
    if (!info) return;
    const path = 'photos/products/product-' + String(index + 1).padStart(4, '0') + '-' + safeFilename(product.id || product.name) + '.' + info.ext;
    archive.file(path, info.base64, { base64: true });
    media.push({ path, mime: info.mime, kind: 'Фото товара', title: str(product.name), sizeBytes: Math.floor(info.base64.length * 3 / 4) });
    product.imageArchivePath = path;
    product.imageArchiveMime = info.mime;
    product.image = '';
  });

  docs.forEach((doc, docIndex) => {
    if (!Array.isArray(doc.attachments)) return;
    doc.attachments.forEach((attachment, attachmentIndex) => {
      const info = mimeDetails(attachment && attachment.data);
      if (!info) return;
      let name = safeFilename(attachment.name || ('attachment-' + (attachmentIndex + 1) + '.' + info.ext));
      if (!/\.[a-z0-9]{2,6}$/i.test(name)) name += '.' + info.ext;
      const path = 'attachments/doc-' + String(docIndex + 1).padStart(4, '0') + '-' + safeFilename(doc.number || doc.id) + '-' + String(attachmentIndex + 1).padStart(2, '0') + '-' + name;
      archive.file(path, info.base64, { base64: true });
      media.push({ path, mime: info.mime, kind: 'Вложение документа', title: str(attachment.name || name), sizeBytes: Math.floor(info.base64.length * 3 / 4) });
      attachment.archivePath = path;
      attachment.archiveMime = info.mime;
      attachment.data = '';
    });
  });

  const summary = moneySummary(state);
  const productsRows = [['ID','Название','Тип','Единица','Остаток','Себестоимость за единицу','Приходная цена','Цена продажи','Фото в архиве']];
  products.forEach((p) => productsRows.push([p.id,p.name,p.type,p.unit,num(p.stock),num(p.cost),num(p.receipt),num(p.sale),p.imageArchivePath || (p.image ? 'Внешняя ссылка/данные сохранены в карточке' : 'Нет')]));

  const clientsRows = [['ID','Клиент','Телефон','Тип','Услуг','Обработано, кг','Выручка услуг','Продажи товара','Выручка продаж','Оплачено','Текущий долг','Последняя услуга']];
  clients.forEach((c) => {
    const own = (state.docs || []).filter((d) => d.clientId === c.id && (d.type === 'sale' || d.type === 'service'));
    const services = own.filter((d) => d.type === 'service');
    const sales = own.filter((d) => d.type === 'sale');
    const processed = services.reduce((sum, d) => sum + qty(d), 0);
    const serviceRev = services.reduce((sum, d) => sum + docAmount(d), 0);
    const salesRev = sales.reduce((sum, d) => sum + docAmount(d), 0);
    const paid = own.reduce((sum, d) => sum + Math.min(docAmount(d), num(d.paid)), 0);
    const balance = own.reduce((sum, d) => sum + Math.max(0, docAmount(d) - num(d.paid)), 0);
    const last = services.slice().sort((a,b) => str(b.date).localeCompare(str(a.date)))[0];
    clientsRows.push([c.id,c.name,c.phone || '',c.kind || '',services.length,processed,serviceRev,sales.reduce((sum,d) => sum+qty(d),0),salesRev,paid,balance,last ? last.date : '']);
  });

  const docsRows = [['ID','Дата','Номер','Тип','Клиент/поставщик','Продукция','Количество','Сумма','Себестоимость','Оплачено','Долг','Комментарий','Файлов прикреплено']];
  const lineRows = [['Документ ID','Дата','Номер','Тип','Клиент/поставщик','ID продукции','Продукция','Количество','Цена за единицу','Себестоимость за единицу','Сумма позиции','Себестоимость позиции']];
  docs.forEach((d) => {
    const clientName = (d.type === 'receipt' ? str(d.supplier || '') : str((clientById.get(d.clientId) || {}).name || ''));
    const items = docItems(d);
    docsRows.push([d.id,d.date,d.number,docTypeLabel(d.type),clientName,items.map((x) => str(getProduct(state,x.productId).name || x.note || 'Продукция')).join(', '),qty(d),docAmount(d),docCost(d),num(d.paid),Math.max(0,docAmount(d)-num(d.paid)),d.note || '',(d.attachments || []).length]);
    items.forEach((item) => lineRows.push([d.id,d.date,d.number,docTypeLabel(d.type),clientName,item.productId,str(getProduct(state,item.productId).name || ''),num(item.qty),num(item.price),num(item.cost),num(item.qty)*num(item.price),num(item.qty)*num(item.cost)]));
    const monthKey = /^\d{4}-\d{2}/.test(str(d.date)) ? str(d.date).slice(0,7) : '';
    if (monthKey && (d.type === 'sale' || d.type === 'service')) {
      const row = monthly.get(monthKey) || { month: monthKey, sales: 0, services: 0, saleCost: 0, serviceCost: 0, debt: 0, expenses: 0, included: 0, extra: 0 };
      if (d.type === 'sale') { row.sales += docAmount(d); row.saleCost += docCost(d); }
      else { row.services += docAmount(d); row.serviceCost += docCost(d); }
      row.debt += Math.max(0,docAmount(d)-num(d.paid)); monthly.set(monthKey,row);
    }
    if (d.type === 'sale') {
      items.forEach((item) => {
        const row = productTotals.get(item.productId) || { productId:item.productId, qty:0, revenue:0, cost:0 };
        row.qty += num(item.qty); row.revenue += num(item.qty)*num(item.price); row.cost += num(item.qty)*num(item.cost); productTotals.set(item.productId,row);
      });
    } else if (d.type === 'service') {
      const row = serviceTotals.get(d.productId) || { productId:d.productId, qty:0, revenue:0, cost:0 };
      row.qty += qty(d); row.revenue += docAmount(d); row.cost += docCost(d); serviceTotals.set(d.productId,row);
    }
  });

  expenses.forEach((e) => {
    const key = /^\d{4}-\d{2}/.test(str(e.date)) ? str(e.date).slice(0,7) : '';
    if (!key) return;
    const row = monthly.get(key) || { month:key, sales:0, services:0, saleCost:0, serviceCost:0, debt:0, expenses:0, included:0, extra:0 };
    row.expenses += num(e.amount);
    if (e.inCost) row.included += num(e.amount); else row.extra += num(e.amount);
    monthly.set(key,row);
  });

  const productReport = [['Продукция','Продано, кг','Выручка','Себестоимость','Валовая прибыль']];
  products.forEach((p) => { const r=productTotals.get(p.id)||{qty:0,revenue:0,cost:0}; productReport.push([p.name,r.qty,r.revenue,r.cost,r.revenue-r.cost]); });
  const serviceReport = [['Услуга','Сырьё, кг','Выручка','Себестоимость услуги','Вклад в прибыль']];
  products.filter((p) => p.type === 'Услуга').forEach((p) => { const r=serviceTotals.get(p.id)||{qty:0,revenue:0,cost:0}; serviceReport.push([p.name,r.qty,r.revenue,r.cost,r.revenue-r.cost]); });
  const expensesRows = [['ID','Дата','Категория','Описание','Сумма','Уже включено в себестоимость']];
  expenses.forEach((e) => expensesRows.push([e.id,e.date,e.category,e.note || '',num(e.amount),e.inCost?'Да':'Нет']));
  const paymentsRows = [['ID','Дата','Клиент','Сумма','Способ','Распределение платежа']];
  payments.forEach((p) => {
    const allocation = Array.isArray(p.allocations) ? p.allocations.map((a) => {
      if (a && typeof a === 'object') { const d=docById.get(a.docId); return (d ? d.number : a.docId || 'Документ')+' — '+num(a.amount); }
      return str(a);
    }).join('; ') : '';
    paymentsRows.push([p.id,p.date,str((clientById.get(p.clientId)||{}).name||''),num(p.amount),p.method || '',allocation]);
  });
  const batchesRows = [['ID','Дата','Продукт','Сырьё','Исходный вес, кг','Выход, кг','Суммарная себестоимость','Себестоимость/кг']];
  (state.batches||[]).forEach((b) => batchesRows.push([b.id,b.date,str(getProduct(state,b.productId).name || b.rawName || ''),b.rawName || '',num(b.rawQty),num(b.outputQty),num(b.totalCost),num(b.totalCost)/Math.max(num(b.outputQty),0.001)]));
  const recipesRows = [['Название','Тип','Эмодзи','Описание']];
  (state.recipes||[]).forEach((r) => recipesRows.push([r.name,r.kind,r.emoji || '',r.desc || '']));
  const monthRows = [['Месяц','Продажи товара','Выручка услуг','Всего выручка','Себестоимость товара','Себестоимость услуг','Всего себестоимость','Все затраты','Включено в себестоимость','Дополнительные расходы','Расчётная прибыль','Долг по документам месяца']];
  Array.from(monthly.values()).sort((a,b) => a.month.localeCompare(b.month)).forEach((r) => monthRows.push([r.month,r.sales,r.services,r.sales+r.services,r.saleCost,r.serviceCost,r.saleCost+r.serviceCost,r.expenses,r.included,r.extra,r.sales+r.services-r.saleCost-r.serviceCost-r.extra,r.debt]));
  const summaryRows = [
    ['Показатель','Значение'],
    ['Дата экспорта',backup.exportedAt || new Date().toISOString()],
    ['Документов',docs.length],['Клиентов',clients.length],['Карточек продукции',products.length],
    ['Финансовые документы — выручка',summary.revenue],['Себестоимость финансовых документов',summary.costs],
    ['Все затраты',summary.totalExpenses],['Затраты, включённые в себестоимость (не вычитать повторно)',summary.included],
    ['Дополнительные расходы',summary.extra],['Расчётная прибыль',summary.profit],['Долг по документам',summary.debt],
    ['Фотографий и вложений вынесено в архив',media.length]
  ];
  const mediaRows = [['Путь в архиве','Тип файла','Тип данных','Название','Размер, байт']];
  media.forEach((m) => mediaRows.push([m.path,m.kind,m.mime,m.title,m.sizeBytes]));
  const workbook = XLSX.utils.book_new();
  addWorksheet(workbook,'Сводка',summaryRows);
  addWorksheet(workbook,'Продукция',productsRows);
  addWorksheet(workbook,'Клиенты',clientsRows);
  addWorksheet(workbook,'Документы',docsRows);
  addWorksheet(workbook,'Позиции',lineRows);
  addWorksheet(workbook,'Затраты',expensesRows);
  addWorksheet(workbook,'Оплаты',paymentsRows);
  addWorksheet(workbook,'Партии',batchesRows);
  addWorksheet(workbook,'Рецепты',recipesRows);
  addWorksheet(workbook,'Продажи',productReport);
  addWorksheet(workbook,'Услуги',serviceReport);
  addWorksheet(workbook,'По месяцам',monthRows);
  addWorksheet(workbook,'Файлы',mediaRows);

  const workbookBase64 = XLSX.write(workbook,{bookType:'xlsx',type:'base64'});
  archive.file('reports/koptilnya-financial-reports.xlsx',workbookBase64,{base64:true});
  const databaseBackup = Object.assign({},backup,{format:'koptilnya-backup',version:2,contents:state});
  archive.file('data/database.json',JSON.stringify(databaseBackup,null,2));
  archive.file('README.txt',
    'КОПТИЛЬНЯ — ПОЛНЫЙ АРХИВ\\n\\n' +
    'data/database.json — данные приложения; восстановление доступно через кнопку «Восстановить».\\n' +
    'reports/koptilnya-financial-reports.xlsx — книга Excel со сводкой, продукцией, клиентами, документами, позициями, затратами, оплатами, партиями, рецептами, продажами по продуктам, услугами и помесячной сводкой.\\n' +
    'photos/ и attachments/ — фотографии товаров и вложения документов; пути для восстановления указаны в database.json.\\n\\n' +
    'Архив создан локально на устройстве. Перед переустановкой приложения сохраните его за пределами устройства.\\n'
  );
  archive.file('manifest.json',JSON.stringify({application:'Коптильня',format:'koptilnya-full-archive',version:2,exportedAt:backup.exportedAt || new Date().toISOString(),files:media},null,2));

  const filename = 'koptilnya-archive-' + dateTag + '.zip';
  if (isNative) {
    const zippedBase64 = await archive.generateAsync({type:'base64',compression:'DEFLATE',compressionOptions:{level:6}});
    await saveBase64ToDownloads(filename,zippedBase64,'application/zip');
  } else {
    const zippedBlob = await archive.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
    downloadBlob(filename,zippedBlob);
  }
  return filename;
}

async function readBackupFile(file) {
  const name = str(file && file.name).toLowerCase();
  if (name.endsWith('.zip')) {
    const archive = await JSZip.loadAsync(file);
    const databaseFile = archive.file('data/database.json') || archive.file('database.json');
    if (!databaseFile) throw new Error('В ZIP-архиве нет data/database.json');
    const parsed = JSON.parse(await databaseFile.async('text'));
    const state = parsed && parsed.format === 'koptilnya-backup' ? parsed.contents : parsed;
    if (!state) throw new Error('Резервная база в архиве пустая');
    for (const product of state.products || []) {
      if (!product.imageArchivePath) continue;
      const mediaFile = archive.file(product.imageArchivePath);
      if (!mediaFile) throw new Error('Не найдена фотография в архиве: ' + product.imageArchivePath);
      const base64 = await mediaFile.async('base64');
      product.image = 'data:' + (product.imageArchiveMime || mimeFromPath(product.imageArchivePath)) + ';base64,' + base64;
      delete product.imageArchivePath; delete product.imageArchiveMime;
    }
    for (const doc of state.docs || []) {
      for (const attachment of doc.attachments || []) {
        if (!attachment.archivePath) continue;
        const mediaFile = archive.file(attachment.archivePath);
        if (!mediaFile) throw new Error('Не найден файл в архиве: ' + attachment.archivePath);
        const base64 = await mediaFile.async('base64');
        attachment.data = 'data:' + (attachment.archiveMime || mimeFromPath(attachment.archivePath)) + ';base64,' + base64;
        delete attachment.archivePath; delete attachment.archiveMime;
      }
    }
    return parsed;
  }
  return JSON.parse(await file.text());
}

async function saveTextFile(filename, mimeType, content) {
  const safeName = safeFilename(filename);
  if (!isNative) {
    downloadBlob(safeName, new Blob([String(content)], {type: mimeType || 'application/octet-stream'}));
    return { filename: safeName };
  }
  const result = await KoptilnyaDownloads.saveToDownloads({
    fileName: safeName,
    mimeType: mimeType || 'application/octet-stream',
    data: utf8ToBase64(content),
  });
  return { uri: result && result.uri, filename: safeName, path: 'Download/Коптильня/' + safeName };
}


async function exportExcel(state) {
  const snapshot = state && typeof state === 'object' ? state : {};
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const clients = Array.isArray(snapshot.clients) ? snapshot.clients : [];
  const docs = Array.isArray(snapshot.docs) ? snapshot.docs : [];
  const expenses = Array.isArray(snapshot.expenses) ? snapshot.expenses : [];
  const payments = Array.isArray(snapshot.payments) ? snapshot.payments : [];
  const batches = Array.isArray(snapshot.batches) ? snapshot.batches : [];
  const byClient = new Map(clients.map((client) => [client.id, client]));
  const byProduct = new Map(products.map((product) => [product.id, product]));
  const workbook = XLSX.utils.book_new();
  addWorksheet(workbook, 'Продукция', [
    ['ID', 'Название', 'Тип', 'Единица', 'Остаток', 'Себестоимость', 'Цена продажи', 'Фотография сохранена (полный архив)'],
    ...products.map((p) => [p.id, p.name, p.type || 'Готовая продукция', p.unit || 'кг', num(p.stock), num(p.cost), num(p.sale), p.image ? 'Да' : 'Нет']),
  ]);
  addWorksheet(workbook, 'Клиенты', [
    ['ID', 'Клиент', 'Телефон', 'Тип'],
    ...clients.map((client) => [client.id, client.name, client.phone || '', client.kind || 'Контрагент']),
  ]);
  addWorksheet(workbook, 'Документы', [
    ['ID', 'Дата', 'Номер', 'Тип', 'Клиент/поставщик', 'Продукция', 'Количество', 'Сумма', 'Себестоимость', 'Оплачено', 'Комментарий'],
    ...docs.map((doc) => [
      doc.id, doc.date, doc.number || '',
      ({sale:'Расходный',receipt:'Приходный',service:'Услуга'})[doc.type] || docTypeLabel(doc.type),
      (byClient.get(doc.clientId) || {}).name || doc.supplier || doc.customerName || '',
      docItems(doc).map((item) => ((byProduct.get(item.productId) || {}).name || item.note || 'Продукция') + ' — ' + num(item.qty)).join('; '),
      qty(doc), docAmount(doc), docCost(doc), num(doc.paid), doc.note || '',
    ]),
  ]);
  const exportDocById = new Map(docs.map((doc) => [doc.id, doc]));
  const positionRows = docs.flatMap((doc) => docItems(doc)
    .filter((item) => item.productId && num(item.qty) > 0)
    .map((item) => [
      doc.id, doc.date, doc.number || '', item.productId,
      (byProduct.get(item.productId) || {}).name || item.note || '',
      num(item.qty), num(item.price), num(item.cost), num(item.qty) * num(item.price), num(item.qty) * num(item.cost),
    ]));
  addWorksheet(workbook, 'Позиции', [
    ['Документ ID', 'Дата', 'Номер', 'ID продукции', 'Продукция', 'Количество', 'Цена за единицу', 'Себестоимость за единицу', 'Сумма позиции', 'Себестоимость позиции'],
    ...positionRows,
  ]);
  addWorksheet(workbook, 'Затраты', [
    ['ID', 'Дата', 'Категория', 'Описание', 'Сумма', 'Уже включено в себестоимость'],
    ...expenses.map((expense) => [expense.id, expense.date, expense.category || '', expense.note || '', num(expense.amount), expense.inCost ? 'Да' : 'Нет']),
  ]);
  addWorksheet(workbook, 'Оплаты', [
    ['ID', 'Дата', 'Клиент', 'Сумма', 'Способ', 'Распределение платежа', 'Комментарий'],
    ...payments.map((payment) => [
      payment.id, payment.date, (byClient.get(payment.clientId) || {}).name || '', num(payment.amount), payment.method || '',
      (payment.allocations || []).map((allocation) => {
        const doc = exportDocById.get(allocation.docId);
        return (doc && doc.number || allocation.docId || 'Документ') + ' — ' + num(allocation.amount);
      }).join('; '), payment.note || '',
    ]),
  ]);
  addWorksheet(workbook, 'Партии', [
    ['ID', 'Дата', 'Продукт', 'Сырьё', 'Исходный вес, кг', 'Выход, кг', 'Суммарная себестоимость'],
    ...batches.map((batch) => [batch.id, batch.date, (byProduct.get(batch.productId) || {}).name || '', batch.rawName || '', num(batch.rawQty), num(batch.outputQty), num(batch.totalCost)]),
  ]);
  const exportDate = new Date().toISOString().slice(0, 10);
  const filename = 'koptilnya-data-' + exportDate + '.xlsx';
  const base64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64', compression: true });
  await saveBase64ToDownloads(filename, base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return filename;
}

async function pickImage() {
  if (!isNative) return null;
  const result = await KoptilnyaDownloads.pickImage();
  if (!result || !result.base64) return null;
  const mimeType = String(result.mimeType || 'image/jpeg');
  return {
    dataUrl: 'data:' + mimeType + ';base64,' + result.base64,
    fileName: String(result.fileName || 'product-photo'),
    mimeType,
  };
}

async function getLicenseIdentity() {
  if (!isNative) return null;
  return await KoptilnyaDownloads.getLicenseIdentity();
}
async function getTrialState() {
  if (!isNative) return null;
  return await KoptilnyaDownloads.getTrialState();
}
async function saveTrialState(state) {
  if (!isNative) return;
  await KoptilnyaDownloads.saveTrialState({
    firstRunAt: Number(state && state.firstRunAt) || 0,
    lastSeenAt: Number(state && state.lastSeenAt) || 0,
  });
}

let businessStateSaveQueue = Promise.resolve();
async function loadBusinessState() {
  if (!isNative) return null;
  return await KoptilnyaDownloads.loadBusinessState();
}
async function saveBusinessState(state) {
  if (!isNative) return null;
  const serialized = typeof state === 'string' ? state : JSON.stringify(state);
  businessStateSaveQueue = businessStateSaveQueue.catch(() => {}).then(() =>
    KoptilnyaDownloads.saveBusinessState({ state: serialized }),
  );
  return await businessStateSaveQueue;
}

window.KoptilnyaNative = {
  isNative,
  saveTextFile,
  exportFullArchive,
  exportExcel,
  pickImage,
  readBackupFile,
  getLicenseIdentity,
  getTrialState,
  saveTrialState,
  loadBusinessState,
  saveBusinessState,
};
window.dispatchEvent(new CustomEvent('koptilnya-native-ready'));
