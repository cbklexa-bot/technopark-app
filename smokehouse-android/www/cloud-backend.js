import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const runtimeConfig = window.KoptilnyaCloudConfig || {};
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || runtimeConfig.url || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.publishableKey || '',
).trim();
const configured = /^https:\/\/[^/]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

const EMPTY_STATE = () => ({
  products: [], clients: [], docs: [], expenses: [], batches: [], recipes: [], payments: [], importHistory: [],
});
const CANONICAL_CLIENTS = [
  'Тортика', 'Деревенька', 'Пекарня', 'Кочевник', 'Наш', 'Клиенты цеха',
];
const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').trim();
const norm = (value) => clean(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[\s_.\-—–:№()]/g, '');
const num = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(clean(value).replace(/\s/g, '').replace(/,/g, '.').replace(/[₽руб.]/gi, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const stableId = (value, prefix) => {
  const id = clean(value);
  return id || prefix + '-' + crypto.randomUUID();
};
const arrayRows = (workbook, sheetName) => {
  if (!sheetName || !workbook.Sheets[sheetName]) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true });
};
const headerValue = (row, aliases) => {
  const wanted = new Set(aliases.map(norm));
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(norm(key)) && value !== null && value !== undefined && clean(value) !== '') return value;
  }
  return '';
};
const dateISO = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return String(date.y).padStart(4, '0') + '-' + String(date.m).padStart(2, '0') + '-' + String(date.d).padStart(2, '0');
  }
  const text = clean(value);
  let m = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return '';
};
const amountForState = (d) => {
  if (d && d.manualAmount != null && d.manualAmount !== '') return num(d.manualAmount);
  return (Array.isArray(d?.items) ? d.items : []).reduce((sum, item) => sum + num(item.qty) * num(item.price), 0);
};
const costForState = (d) => {
  if (d && d.manualCost != null && d.manualCost !== '') return num(d.manualCost);
  return (Array.isArray(d?.items) ? d.items : []).reduce((sum, item) => sum + num(item.qty) * num(item.cost), 0);
};
const rowDocType = (value, sheetName = '') => {
  const text = norm(value || sheetName);
  if (text.includes('приход') || text.includes('закуп') || text.includes('receipt')) return 'receipt';
  if (text.includes('услуг') || text.includes('обработ') || text.includes('service')) return 'service';
  if (text.includes('продаж') || text.includes('расход') || text.includes('реализац') || text.includes('sale')) return 'sale';
  return '';
};
const findSheet = (workbook, aliases) => {
  const wanted = new Set(aliases.map(norm));
  return workbook.SheetNames.find((name) => wanted.has(norm(name))) || '';
};
const parseWorkbook = (workbook, filename) => {
  const sourceNames = {
    products: findSheet(workbook, ['Продукция', 'Товары', 'Справочник продукции', 'Products']),
    clients: findSheet(workbook, ['Клиенты', 'Контрагенты', 'Покупатели', 'Clients']),
    documents: findSheet(workbook, ['Документы', 'Накладные', 'Documents']),
    positions: findSheet(workbook, ['Позиции', 'Позиции накладных', 'Строки документов', 'Document items']),
    expenses: findSheet(workbook, ['Затраты', 'Расходы', 'Expenses']),
    payments: findSheet(workbook, ['Оплаты', 'Платежи', 'Payments']),
    batches: findSheet(workbook, ['Партии', 'Производство', 'Выпуск', 'Production']),
  };
  const rawProducts = arrayRows(workbook, sourceNames.products);
  const rawClients = arrayRows(workbook, sourceNames.clients);
  const rawDocs = arrayRows(workbook, sourceNames.documents);
  const rawPositions = arrayRows(workbook, sourceNames.positions);
  const rawExpenses = arrayRows(workbook, sourceNames.expenses);
  const rawPayments = arrayRows(workbook, sourceNames.payments);
  const rawBatches = arrayRows(workbook, sourceNames.batches);
  const warnings = [];
  if (!sourceNames.documents && !sourceNames.positions) {
    warnings.push('Нет отдельных исходных листов «Документы» и «Позиции». Агрегированные листы «Продажи», «Услуги» и «По месяцам» не импортируются как операции, чтобы не посчитать выручку повторно.');
  }
  const products = rawProducts.map((r) => {
    const rawType = clean(headerValue(r, ['Тип', 'Категория', 'Вид продукции']));
    let type = 'Готовая продукция';
    if (norm(rawType).includes('сыр')) type = 'Сырьё';
    else if (norm(rawType).includes('полу')) type = 'Полуфабрикат';
    else if (norm(rawType).includes('услуг')) type = 'Услуга';
    return {
      id: stableId(headerValue(r, ['ID', 'ID продукции', 'Product ID']), 'import-product'),
      name: clean(headerValue(r, ['Название', 'Наименование', 'Продукция', 'Товар', 'Product'])),
      type,
      emoji: '',
      unit: clean(headerValue(r, ['Единица', 'Единица измерения', 'Ед.изм.', 'Ед.'])) || 'кг',
      stock: num(headerValue(r, ['Остаток', 'Количество на складе', 'Остатки', 'Наличие'])),
      cost: num(headerValue(r, ['Себестоимость за единицу', 'Себестоимость', 'Средняя себестоимость', 'Себестоимость/кг'])),
      receipt: num(headerValue(r, ['Приходная цена', 'Цена прихода', 'Цена закупки', 'Закупочная цена'])),
      sale: num(headerValue(r, ['Цена продажи', 'Цена реализации', 'Продажная цена', 'Цена'])),
      image: '',
    };
  }).filter((p) => p.name);
  const productNames = new Map();
  products.forEach((p) => { const key = norm(p.name); if (key && !productNames.has(key)) productNames.set(key, p.id); });

  const activeClientByName = new Map();
  const clients = [];
  const inactiveCounterpartyNames = new Set();
  if (!sourceNames.clients) warnings.push('В книге не найден лист «Клиенты/Контрагенты». Шесть активных контрагентов будут созданы без телефона и дополнительных реквизитов.');
  rawClients.forEach((r) => {
    const name = clean(headerValue(r, ['Клиент', 'Контрагент', 'Название', 'Наименование', 'Покупатель', 'Имя клиента', 'Name']));
    if (!name) return;
    const key = norm(name);
    const exact = CANONICAL_CLIENTS.find((canonical) => norm(canonical) === key);
    if (!exact) { inactiveCounterpartyNames.add(name); return; } // Other counterparties stay as document name snapshots, never as active clients.
    if (activeClientByName.has(key)) {
      warnings.push('Повтор названия активного контрагента «' + exact + '» на листе «' + sourceNames.clients + '». До импорта проверьте этот лист.');
      return;
    }
    const client = {
      id: stableId(headerValue(r, ['ID', 'ID клиента', 'ID контрагента', 'Client ID']), 'import-client'),
      name: exact,
      phone: clean(headerValue(r, ['Телефон', 'Номер телефона', 'Phone'])),
      kind: clean(headerValue(r, ['Тип', 'Вид', 'Категория'])) || 'Контрагент',
    };
    activeClientByName.set(key, client.id);
    clients.push(client);
  });
  // Always keep the exact six owner-approved active counterparties; other historical names remain on their documents.
  if (inactiveCounterpartyNames.size) {
    warnings.push('Контрагенты вне разрешённой шестёрки останутся только в исторических реквизитах документов и не появятся в активном справочнике: ' + [...inactiveCounterpartyNames].slice(0,30).join(', ') + (inactiveCounterpartyNames.size > 30 ? ', …' : '') + '.');
  }
  {
    CANONICAL_CLIENTS.forEach((name) => {
      if (activeClientByName.has(norm(name))) return;
      const client = { id: 'koptilnya-client-' + norm(name), name, phone: '', kind: 'Контрагент' };
      clients.push(client);
      activeClientByName.set(norm(name), client.id);
    });
  }

  const rowKey = (r) => {
    const explicitId = clean(headerValue(r, ['ID', 'ID документа', 'Документ ID', 'Document ID']));
    const number = clean(headerValue(r, ['Номер', 'Номер документа', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Date']));
    return explicitId ? 'id:' + explicitId : (number ? 'number:' + norm(number) + '|' + date : '');
  };
  const docMap = new Map();
  const docs = [];
  const importedDocKeys = new Set();
  rawDocs.forEach((r, index) => {
    const number = clean(headerValue(r, ['Номер', 'Номер документа', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Date']));
    const key = rowKey(r) || 'row:' + index;
    if (importedDocKeys.has(key)) warnings.push('Повтор ключа документа «' + (number || key) + '» в исходном листе. Эти записи не объединяются автоматически.');
    importedDocKeys.add(key);
    const type = rowDocType(headerValue(r, ['Тип', 'Вид документа', 'Операция']));
    if (!type) {
      warnings.push('Не удалось определить тип документа «' + (number || key) + '». Строка не импортирована.');
      return;
    }
    const counterpartyName = clean(headerValue(r, ['Клиент/поставщик', 'Клиент', 'Контрагент', 'Поставщик', 'Покупатель']));
    const clientId = activeClientByName.get(norm(counterpartyName)) || '';
    const id = stableId(headerValue(r, ['ID', 'ID документа', 'Document ID']), 'import-doc-' + index);
    const amount = num(headerValue(r, ['Сумма', 'Итого', 'Сумма документа', 'Выручка']));
    const cost = num(headerValue(r, ['Себестоимость', 'Сумма себестоимости', 'Себестоимость документа']));
    const rawPaid = headerValue(r, ['Оплачено', 'Оплата', 'Сумма оплат']);
    const doc = {
      id,
      date,
      number: number || ('ИМП-' + (index + 1)),
      type,
      clientId,
      supplier: type === 'receipt' ? counterpartyName : (!clientId ? counterpartyName : ''),
      note: clean(headerValue(r, ['Комментарий', 'Примечание', 'Описание', 'Заметка'])),
      qty: num(headerValue(r, ['Количество', 'Вес', 'Количество, кг', 'Вес, кг'])),
      paid: num(rawPaid),
      items: [],
      sourceRow: index + 2,
    };
    if (date && !['2025','2026'].includes(date.slice(0,4))) {
      warnings.push('Документ «' + doc.number + '» за ' + date.slice(0,4) + ' год не попадёт в оперативную базу (оставлен за пределами периода 2025–2026).');
      return;
    }
    const sourceProductId = clean(headerValue(r, ['ID продукции', 'Продукция ID', 'Product ID']));
    const productId = (products.some((p) => p.id === sourceProductId) ? sourceProductId : '')
      || productNames.get(norm(headerValue(r, ['Продукция', 'Товар', 'Наименование продукции'])));
    if (productId && doc.qty > 0 && rawPositions.length === 0) {
      doc.items.push({
        productId, qty: doc.qty,
        price: doc.qty ? amount / doc.qty : 0,
        cost: doc.qty ? cost / doc.qty : 0,
        note: clean(headerValue(r, ['Продукция', 'Товар'])),
      });
    } else if (amount || cost) {
      doc.manualAmount = amount;
      doc.manualCost = cost;
    }
    doc._headerAmount = amount;
    doc._headerCost = cost;
    if (!date) warnings.push('У документа «' + doc.number + '» отсутствует распознаваемая дата.');
    docMap.set(key, doc);
    docs.push(doc);
  });

  const byNumberAndDate = new Map();
  docs.forEach((d) => {
    const key = norm(d.number) + '|' + d.date;
    if (!byNumberAndDate.has(key)) byNumberAndDate.set(key, d);
  });
  rawPositions.forEach((r, index) => {
    const explicitId = clean(headerValue(r, ['Документ ID', 'ID документа', 'Document ID']));
    const number = clean(headerValue(r, ['Номер', 'Номер документа', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Date']));
    let doc = explicitId ? docMap.get('id:' + explicitId) : null;
    if (!doc && number) doc = byNumberAndDate.get(norm(number) + '|' + date) || docs.find((d) => norm(d.number) === norm(number));
    if (!doc) {
      warnings.push('Строка позиции №' + (index + 2) + ' не сопоставлена документу; она не импортирована.');
      return;
    }
    if (doc.items.length === 0) { delete doc.manualAmount; delete doc.manualCost; }
    const productName = clean(headerValue(r, ['Продукция', 'Наименование продукции', 'Товар', 'Product']));
    const sourceProductId = clean(headerValue(r, ['ID продукции', 'Продукция ID', 'Product ID']));
    const productId = products.some((p) => p.id === sourceProductId) ? sourceProductId : productNames.get(norm(productName));
    const qty = num(headerValue(r, ['Количество', 'Количество, кг', 'Вес', 'Вес, кг', 'Qty']));
    const price = num(headerValue(r, ['Цена за единицу', 'Цена', 'Цена продажи', 'Сумма за единицу']));
    const lineAmount = num(headerValue(r, ['Сумма позиции', 'Сумма', 'Итого']));
    const lineCost = num(headerValue(r, ['Себестоимость позиции', 'Себестоимость', 'Сумма себестоимости']));
    const unitCost = num(headerValue(r, ['Себестоимость за единицу', 'Себестоимость/кг']));
    if (qty <= 0 || (!productId && !productName)) {
      warnings.push('Позиция документа «' + doc.number + '» не содержит однозначного товара или положительного количества.');
      return;
    }
    doc.items.push({
      productId: productId || '',
      qty,
      price: price || (qty ? lineAmount / qty : 0),
      cost: unitCost || (qty ? lineCost / qty : 0),
      note: productId ? '' : productName,
    });
  });

  if (rawPositions.length) {
    docs.forEach((d) => {
      if (d.items.length) d.items = [];
      // The document header total remains as a fallback until its source positions have been matched.
    });
  }

  docs.forEach((d) => {
    if (d.items.length) {
      delete d.manualAmount; delete d.manualCost;
      const lineAmount = d.items.reduce((sum, item) => sum + num(item.qty) * num(item.price), 0);
      const lineCost = d.items.reduce((sum, item) => sum + num(item.qty) * num(item.cost), 0);
      if (d._headerAmount && Math.abs(lineAmount - d._headerAmount) > 0.01) warnings.push('Сумма позиций документа «' + d.number + '» (' + formatMoney(lineAmount) + ') не совпадает с итогом исходного документа (' + formatMoney(d._headerAmount) + '). Проверьте до использования отчётов.');
      if (d._headerCost && Math.abs(lineCost - d._headerCost) > 0.01) warnings.push('Себестоимость позиций документа «' + d.number + '» не совпадает с исходным итогом.');
    } else {
      if (d._headerAmount) d.manualAmount = d._headerAmount;
      if (d._headerCost) d.manualCost = d._headerCost;
    }
    delete d._headerAmount; delete d._headerCost;
  });

  // The old workbook may contain one transaction per row in named sales/service sheets.
  // Summary/report sheets are never treated as operations because they would duplicate revenue.
  if (!sourceNames.documents) {
    warnings.push('В рабочую базу будут импортированы только строки исходных документов. Проверьте, что файл содержит лист «Документы»; сводки не используются для восстановления отдельных накладных.');
  }

  const docByNumber = new Map(docs.map((d) => [norm(d.number), d]));
  const expenses = rawExpenses.map((r, index) => {
    const date = dateISO(headerValue(r, ['Дата', 'Дата затрат', 'Date']));
    if (date && !['2025','2026'].includes(date.slice(0,4))) return null;
    return {
      id: stableId(headerValue(r, ['ID', 'ID затраты']), 'import-expense-' + index),
      date,
      category: clean(headerValue(r, ['Категория', 'Статья', 'Вид затрат', 'Расход'])) || 'Не указано',
      note: clean(headerValue(r, ['Описание', 'Комментарий', 'Примечание', 'Заметка'])),
      amount: num(headerValue(r, ['Сумма', 'Сумма затрат', 'Amount'])),
      inCost: ['да','yes','true','1','включено'].includes(norm(headerValue(r, ['Уже включено в себестоимость', 'Включено в себестоимость', 'В себестоимости']))),
      sourceRow: index + 2,
    };
  }).filter((r) => r && (r.amount > 0 || r.note || r.category !== 'Не указано'));

  const payments = rawPayments.map((r, index) => {
    const date = dateISO(headerValue(r, ['Дата', 'Дата платежа', 'Date']));
    if (date && !['2025','2026'].includes(date.slice(0,4))) return null;
    const clientName = clean(headerValue(r, ['Клиент', 'Контрагент', 'Покупатель']));
    const allocationText = clean(headerValue(r, ['Распределение платежа', 'Распределение', 'По документам', 'Накладные']));
    const allocations = [];
    for (const part of allocationText.split(/[;\n]+/)) {
      const pieces = part.split(/\s[—–-]\s/);
      if (pieces.length < 2) continue;
      const amount = num(pieces.slice(1).join(' - '));
      const doc = docByNumber.get(norm(pieces[0]));
      if (doc && amount > 0) allocations.push({ docId: doc.id, amount });
    }
    return {
      id: stableId(headerValue(r, ['ID', 'ID платежа']), 'import-payment-' + index),
      date,
      clientId: activeClientByName.get(norm(clientName)) || '',
      amount: num(headerValue(r, ['Сумма', 'Платёж', 'Сумма платежа', 'Amount'])),
      method: clean(headerValue(r, ['Способ', 'Способ оплаты', 'Метод оплаты', 'Тип оплаты'])) || 'Не указан',
      allocations,
      note: clean(headerValue(r, ['Комментарий', 'Примечание'])),
    };
  }).filter((p) => p && p.amount > 0);

  const batches = rawBatches.map((r, index) => {
    const date = dateISO(headerValue(r, ['Дата', 'Дата производства', 'Date']));
    if (date && !['2025','2026'].includes(date.slice(0,4))) return null;
    const productName = clean(headerValue(r, ['Продукт', 'Готовая продукция', 'Продукция']));
    const rawName = clean(headerValue(r, ['Сырьё', 'Сырье', 'Наименование сырья']));
    return {
      id: stableId(headerValue(r, ['ID', 'ID партии']), 'import-batch-' + index),
      date,
      productId: productNames.get(norm(productName)) || '',
      rawName: rawName || productName,
      rawQty: num(headerValue(r, ['Исходный вес, кг', 'Исходный вес', 'Вес сырья', 'Количество сырья'])),
      outputQty: num(headerValue(r, ['Выход, кг', 'Выход продукции', 'Выход', 'Количество готовой продукции'])),
      totalCost: num(headerValue(r, ['Суммарная себестоимость', 'Общая себестоимость', 'Затраты партии'])),
    };
  }).filter((b) => b && (b.rawQty > 0 || b.outputQty > 0 || b.totalCost > 0));

  // Reconcile paid amounts to the payment sheet without adding payments to revenue.
  const allocationTotals = new Map();
  payments.forEach((p) => p.allocations.forEach((a) => allocationTotals.set(a.docId, (allocationTotals.get(a.docId) || 0) + a.amount)));
  docs.forEach((d) => {
    if (allocationTotals.has(d.id)) d.paid = Math.min(amountForState(d), allocationTotals.get(d.id));
  });

  const years = {};
  [2025, 2026].forEach((year) => {
    const within = docs.filter((d) => d.date && Number(d.date.slice(0,4)) === year && (d.type === 'sale' || d.type === 'service'));
    const expenseWithin = expenses.filter((e) => e.date && Number(e.date.slice(0,4)) === year);
    const batchWithin = batches.filter((b) => b.date && Number(b.date.slice(0,4)) === year);
    years[year] = {
      revenue: within.reduce((sum, d) => sum + amountForState(d), 0),
      cost: within.reduce((sum, d) => sum + costForState(d), 0),
      expenses: expenseWithin.filter((e) => !e.inCost).reduce((sum, e) => sum + num(e.amount), 0),
      payments: payments.filter((p) => p.date && Number(p.date.slice(0,4)) === year).reduce((sum, p) => sum + p.amount, 0),
      productionKg: batchWithin.reduce((sum, b) => sum + num(b.outputQty), 0),
      docs: within.length,
    };
  });
  const activeClientSet = new Set(clients.map((c) => c.id));
  if (docs.some((d) => d.clientId && !activeClientSet.has(d.clientId))) warnings.push('В истории есть документы с контрагентами вне шести разрешённых. В активный справочник они не попадут; исходное название останется в документе.');
  const duplicateIds = (items, key) => {
    const seen = new Set(); const duplicates = new Set();
    items.forEach((item) => { const value = clean(key(item)); if (value && seen.has(value)) duplicates.add(value); else if (value) seen.add(value); });
    return [...duplicates];
  };
  const duplicatedSourceIds = duplicateIds(docs, (d) => d.id);
  if (duplicatedSourceIds.length) warnings.push('Повторяются идентификаторы документов: ' + duplicatedSourceIds.slice(0,5).join(', ') + '. Проверь их перед импортом.');
  const state = { products, clients, docs, expenses, batches, recipes: [], payments, importHistory: [] };
  const summary = {
    sheets: workbook.SheetNames.map((name) => ({ name, rows: arrayRows(workbook, name).length })),
    counts: { products: products.length, clients: clients.length, documents: docs.length, positions: docs.reduce((sum,d) => sum+d.items.length,0), expenses: expenses.length, payments: payments.length, batches: batches.length },
    years,
    warnings,
    sourceSheets: sourceNames,
  };
  return { state, summary, filename };
};

const css = `
#koptilnyaAuthGate,#koptilnyaImportGate,#koptilnyaAccountGate{position:fixed;inset:0;z-index:100000;background:rgba(12,18,16,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17201c}
.koptilnyaPanel{width:min(570px,100%);max-height:min(90vh,900px);overflow:auto;background:#fff;border-radius:20px;padding:24px;box-shadow:0 18px 70px #0006}
.koptilnyaPanel h2{margin:0 0 7px;font-size:24px;color:#17201c}.koptilnyaPanel p{margin:7px 0 14px;color:#536159}
.koptilnyaField{display:block;margin:12px 0 5px;font-weight:650;font-size:13px;color:#38453e}.koptilnyaPanel input[type=email],.koptilnyaPanel input[type=password],.koptilnyaPanel input[type=text],.koptilnyaPanel input[type=file]{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd3ce;border-radius:10px;padding:12px;font:inherit;background:#fff;color:#17201c}
.koptilnyaActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.koptilnyaButton{border:0;border-radius:10px;background:#1c6046;color:white;font-weight:700;padding:12px 15px;font:inherit;cursor:pointer}.koptilnyaButton.secondary{background:#eef2ef;color:#22362b}.koptilnyaButton:disabled{opacity:.45;cursor:wait}
.koptilnyaStatus{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f1f4f2;color:#35473b;white-space:pre-wrap}.koptilnyaStatus.error{background:#fff0ef;color:#912d26}.koptilnyaStatus.ok{background:#eaf7ef;color:#1d6541}
#koptilnyaCloudBar{position:fixed;z-index:99999;right:10px;top:10px;display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 20px);font:12px/1.3 system-ui,sans-serif}
#koptilnyaCloudState{color:#fff;background:#26392f;border-radius:999px;padding:8px 11px;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.koptilnyaMini{border:0;border-radius:999px;background:#f5f7f5;color:#1b3a2b;padding:8px 11px;font:600 12px system-ui,sans-serif;box-shadow:0 2px 12px #0002;cursor:pointer}
.koptilnyaSheetGrid{display:grid;grid-template-columns:1fr auto;gap:7px 12px;font-size:13px}.koptilnyaSheetGrid>div{padding:7px 0;border-bottom:1px solid #edf0ee}.koptilnyaNumber{text-align:right;font-variant-numeric:tabular-nums}
.koptilnyaYearTable{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}.koptilnyaYearTable td,.koptilnyaYearTable th{padding:7px;border-bottom:1px solid #e4e9e6;text-align:right}.koptilnyaYearTable td:first-child,.koptilnyaYearTable th:first-child{text-align:left}
@media(max-width:480px){.koptilnyaPanel{padding:18px;border-radius:16px}.koptilnyaPanel h2{font-size:21px}#koptilnyaCloudState{display:none}#koptilnyaCloudBar{top:6px;right:6px}}
`;
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

let supabase = null;
let session = null;
let user = null;
let organizationId = null;
let organizationName = '';
let revision = 0;
let cloudActive = false;
let saveTimer = null;
let pendingState = null;
let flushPromise = Promise.resolve();
let syncBlocked = false;
let statusText = 'Подключение';
let lastFileImport = null;

const app = () => window.KoptilnyaApp;
const safeText = (value) => clean(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatMoney = (value) => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:0}).format(num(value));
const toast = (message, isError = false) => {
  let node = document.getElementById('koptilnyaTransientMessage');
  if (!node) {
    node = document.createElement('div');
    node.id = 'koptilnyaTransientMessage';
    node.style.cssText = 'position:fixed;z-index:100004;left:12px;right:12px;bottom:16px;margin:auto;max-width:620px;padding:13px 16px;border-radius:12px;font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 5px 24px #0003;';
    document.body.appendChild(node);
  }
  node.style.background = isError ? '#fff0ef' : '#eaf7ef';
  node.style.color = isError ? '#912d26' : '#1d6541';
  node.textContent = message;
  node.hidden = false;
  if (node._hideTimer) clearTimeout(node._hideTimer);
  node._hideTimer = setTimeout(() => { node.hidden = true; }, 6500);
};
const accountBar = () => {
  let bar = document.getElementById('koptilnyaCloudBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'koptilnyaCloudBar';
  bar.innerHTML = '<span id="koptilnyaCloudState">Подключение</span><button type="button" class="koptilnyaMini" id="koptilnyaImportBtn">Импорт Excel</button><button type="button" class="koptilnyaMini" id="koptilnyaAccountBtn">Аккаунт</button>';
  document.body.appendChild(bar);
  bar.querySelector('#koptilnyaImportBtn').addEventListener('click', openImportPicker);
  bar.querySelector('#koptilnyaAccountBtn').addEventListener('click', openAccount);
  return bar;
};
const setCloudStatus = (text, kind = '') => {
  statusText = text;
  const pill = document.getElementById('koptilnyaCloudState');
  if (pill) {
    pill.textContent = text;
    pill.style.background = kind === 'error' ? '#8b2824' : kind === 'ok' ? '#246142' : '#26392f';
  }
};
const createOverlay = (id, title, description) => {
  document.getElementById(id)?.remove();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.innerHTML = '<div class="koptilnyaPanel"><h2>' + title + '</h2><p>' + description + '</p><div id="' + id + 'Body"></div><div class="koptilnyaStatus" id="' + id + 'Status" aria-live="polite"></div></div>';
  document.body.appendChild(overlay);
  return overlay;
};
const setOverlayStatus = (id, message, kind = '') => {
  const box = document.getElementById(id + 'Status');
  if (!box) return;
  box.textContent = message;
  box.className = 'koptilnyaStatus ' + kind;
};
const renderConfigBlocker = () => {
  const gate = createOverlay('koptilnyaAuthGate', 'Коптильня — подключение', 'Эта сборка закрывает учётные данные до подключения к отдельной серверной базе.');
  const body = gate.querySelector('#koptilnyaAuthGateBody');
  body.innerHTML = '<div class="koptilnyaStatus error">Сервер не настроен. Не вводите пароль в эту сборку. Для включения входа нужно подключить отдельный проект Supabase «Коптильня» и задать его публичные URL и publishable key при сборке.</div><p>Данные тестового приложения не были загружены в облако и не изменены.</p>';
  setOverlayStatus('koptilnyaAuthGate', 'Вход пока недоступен: в приложении нет URL/ключа отдельного проекта.', 'error');
};
const renderAuth = (mode = 'signin', message = '') => {
  const gate = createOverlay('koptilnyaAuthGate', 'Коптильня', 'Войдите, чтобы открыть свою коптильню и синхронизировать данные между устройствами.');
  const body = gate.querySelector('#koptilnyaAuthGateBody');
  const signingUp = mode === 'signup';
  body.innerHTML = `
    <form id="koptilnyaAuthForm">
      <label class="koptilnyaField" for="koptilnyaEmail">Электронная почта</label>
      <input id="koptilnyaEmail" type="email" name="email" autocomplete="email" required maxlength="254" />
      <label class="koptilnyaField" for="koptilnyaPassword">Пароль</label>
      <input id="koptilnyaPassword" type="password" name="password" autocomplete="${signingUp ? 'new-password' : 'current-password'}" minlength="8" required />
      ${signingUp ? '<label class="koptilnyaField" for="koptilnyaOrgName">Название коптильни</label><input id="koptilnyaOrgName" type="text" name="orgName" maxlength="120" value="Коптильня" required />' : ''}
      <div class="koptilnyaActions"><button class="koptilnyaButton" id="koptilnyaAuthSubmit" type="submit">${signingUp ? 'Создать аккаунт' : 'Войти'}</button><button class="koptilnyaButton secondary" type="button" id="koptilnyaAuthSwitch">${signingUp ? 'Уже есть аккаунт' : 'Регистрация'}</button></div>
      ${!signingUp ? '<button class="koptilnyaButton secondary" style="margin-top:9px" id="koptilnyaReset" type="button">Восстановить пароль</button>' : ''}
    </form>`;
  body.querySelector('#koptilnyaAuthSwitch').addEventListener('click', () => renderAuth(signingUp ? 'signin' : 'signup'));
  const form = body.querySelector('#koptilnyaAuthForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = body.querySelector('#koptilnyaAuthSubmit');
    submit.disabled = true;
    const data = new FormData(form);
    const email = clean(data.get('email')).toLowerCase();
    const password = String(data.get('password') || '');
    try {
      if (signingUp) {
        const {data: result, error} = await supabase.auth.signUp({
          email, password,
          options: {data: {full_name: email.split('@')[0]}}
        });
        if (error) throw error;
        if (!result.session) {
          renderAuth('signin', '');
          setOverlayStatus('koptilnyaAuthGate', 'Аккаунт создан. Если в проекте включено подтверждение почты, подтвердите адрес в письме, затем войдите.', 'ok');
          return;
        }
        /* The auth-state listener opens the newly created session exactly once. */
      } else {
        const {data: result, error} = await supabase.auth.signInWithPassword({email, password});
        if (error) throw error;
        /* The auth-state listener opens the signed-in session exactly once. */
      }
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', error?.message || 'Не удалось войти. Проверьте соединение и реквизиты.', 'error');
    } finally {
      submit.disabled = false;
    }
  });
  const reset = body.querySelector('#koptilnyaReset');
  if (reset) reset.addEventListener('click', async () => {
    const email = clean(body.querySelector('#koptilnyaEmail').value).toLowerCase();
    if (!email) { setOverlayStatus('koptilnyaAuthGate', 'Введите электронную почту для восстановления пароля.', 'error'); return; }
    reset.disabled = true;
    try {
      const {error} = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      setOverlayStatus('koptilnyaAuthGate', 'Если для адреса существует аккаунт, инструкция восстановления будет отправлена на почту.', 'ok');
    } catch (error) { setOverlayStatus('koptilnyaAuthGate', error?.message || 'Не удалось отправить запрос восстановления.', 'error'); }
    finally { reset.disabled = false; }
  });
  if (message) setOverlayStatus('koptilnyaAuthGate', message, 'error');
};
const openAccount = () => {
  const gate = createOverlay('koptilnyaAccountGate', 'Аккаунт', 'Текущий серверный профиль и синхронизация.');
  gate.querySelector('#koptilnyaAccountGateBody').innerHTML = `
    <div class="koptilnyaStatus"><b>Пользователь:</b> ${safeText(user?.email || '')}<br><b>Коптильня:</b> ${safeText(organizationName)}<br><b>Синхронизация:</b> ${safeText(statusText)}<br><b>Ревизия данных:</b> ${revision}</div>
    <div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaReload">Обновить с сервера</button><button type="button" class="koptilnyaButton" id="koptilnyaSignOut">Выйти</button><button type="button" class="koptilnyaButton secondary" id="koptilnyaAccountClose">Закрыть</button></div>`;
  gate.querySelector('#koptilnyaReload').addEventListener('click', async () => {
    gate.remove();
    await reloadRemoteState();
    openAccount();
  });
  gate.querySelector('#koptilnyaSignOut').addEventListener('click', async () => {
    const {error} = await supabase.auth.signOut();
    if (error) { setOverlayStatus('koptilnyaAccountGate', error.message, 'error'); return; }
    cloudActive = false; organizationId = null; user = null; session = null;
    gate.remove(); accountBar().style.display = 'none'; renderAuth('signin');
  });
  gate.querySelector('#koptilnyaAccountClose').addEventListener('click', () => gate.remove());
};

const ensureWorkspace = async (currentSession, desiredName = 'Коптильня') => {
  session = currentSession;
  user = currentSession.user;
  let {data: memberships, error} = await supabase
    .from('organization_members')
    .select('organization_id, role, status, organizations(name, timezone)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1);
  if (error) throw error;
  if (!memberships?.length) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const {data: newOrgId, error: createError} = await supabase.rpc('create_organization', {
      p_name: desiredName || 'Коптильня',
      p_timezone: timeZone,
    });
    if (createError) throw createError;
    organizationId = newOrgId;
    const loaded = await supabase.from('organizations').select('name').eq('id', organizationId).single();
    if (loaded.error) throw loaded.error;
    organizationName = loaded.data.name;
  } else {
    const membership = memberships[0];
    organizationId = membership.organization_id;
    organizationName = membership.organizations?.name || 'Коптильня';
  }
  return {organizationId, organizationName};
};
const renderInitialChoice = (remoteRevision, remoteState, localState) => new Promise((resolve) => {
  const localHasData = localState && ['products','clients','docs','expenses','batches','payments'].some((key) => Array.isArray(localState[key]) && localState[key].length);
  if (!localHasData) { resolve({state: EMPTY_STATE(), revision: remoteRevision}); return; }
  const gate = createOverlay('koptilnyaInitialDataGate', 'Данные на этом телефоне', 'На устройстве уже есть локальные записи, но в облачной коптильне пока нет базы. Выбери, что перенести. Ничего не будет отправлено без подтверждения.');
  const body = gate.querySelector('#koptilnyaInitialDataGateBody');
  const counts = ['products','clients','docs','expenses','batches','payments'].map((key) => key + ': ' + (Array.isArray(localState[key]) ? localState[key].length : 0)).join('\n');
  body.innerHTML = '<div class="koptilnyaStatus">' + safeText(counts) + '</div><div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaMigrateLocal">Перенести эти данные в облако</button><button type="button" class="koptilnyaButton secondary" id="koptilnyaStartEmpty">Начать с пустой базы</button></div>';
  body.querySelector('#koptilnyaMigrateLocal').addEventListener('click', () => { gate.remove(); resolve({state: localState, revision: remoteRevision}); });
  body.querySelector('#koptilnyaStartEmpty').addEventListener('click', () => { gate.remove(); resolve({state: EMPTY_STATE(), revision: remoteRevision}); });
});
const openWorkspace = async (currentSession, desiredName = 'Коптильня') => {
  const gate = document.getElementById('koptilnyaAuthGate');
  if (gate) setOverlayStatus('koptilnyaAuthGate', 'Загружаю данные коптильни…');
  setCloudStatus('Загрузка…');
  try {
    await ensureWorkspace(currentSession, desiredName);
    const {data: remote, error} = await supabase
      .from('organization_data')
      .select('state, revision, updated_at')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw error;
    let chosen;
    if (!remote) {
      const local = app()?.getLocalState?.();
      chosen = await renderInitialChoice(0, EMPTY_STATE(), local);
    } else {
      chosen = {state: remote.state || EMPTY_STATE(), revision: Number(remote.revision) || 0};
    }
    revision = chosen.revision;
    app()?.setState(chosen.state);
    cloudActive = true;
    syncBlocked = false;
    if (gate) gate.remove();
    document.getElementById('koptilnyaInitialDataGate')?.remove();
    accountBar().style.display = 'flex';
    setCloudStatus('Облако подключено', 'ok');
    flushPromise = Promise.resolve();
    if (!remote || (chosen.state && !remote?.state)) queueSave(app().getState());
  } catch (error) {
    cloudActive = false;
    setCloudStatus('Ошибка облака', 'error');
    renderAuth('signin', 'Не удалось открыть коптильню: ' + (error?.message || 'ошибка сервера'));
  }
};

const flushSave = async () => {
  if (!cloudActive || !organizationId || syncBlocked || !pendingState) return;
  const latest = pendingState;
  pendingState = null;
  setCloudStatus('Сохраняю…');
  const {data, error} = await supabase.rpc('save_organization_data', {
    p_organization_id: organizationId,
    p_expected_revision: revision,
    p_state: latest,
  });
  if (error) {
    if (error.code === '40001') {
      syncBlocked = true;
      setCloudStatus('Конфликт данных', 'error');
      toast('Данные изменились на другом устройстве. Чтобы избежать перезаписи, обнови приложение и повтори изменение.', true);
      return;
    }
    setCloudStatus('Ошибка сохранения', 'error');
    toast('Не удалось сохранить в облако. Записи пока остаются на телефоне: ' + (error.message || ''), true);
    return;
  }
  revision = Number(data) || revision + 1;
  setCloudStatus('Сохранено', 'ok');
  if (pendingState) await flushSave();
};
const queueSave = (state) => {
  if (!cloudActive || syncBlocked) return;
  pendingState = JSON.parse(JSON.stringify(state));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushPromise = flushPromise.then(() => flushSave()).catch((error) => {
      setCloudStatus('Ошибка сохранения', 'error');
      toast(error?.message || 'Ошибка синхронизации', true);
    });
  }, 650);
};

const openImportPicker = () => {
  const gate = createOverlay('koptilnyaImportGate', 'Импорт из Excel', 'Исходный файл будет прочитан на устройстве; до подтверждения он никуда не загружается. Импорт заменит данные текущей облачной коптильни, сохрани её экспорт перед началом.');
  const body = gate.querySelector('#koptilnyaImportGateBody');
  body.innerHTML = `
    <label class="koptilnyaField" for="koptilnyaExcelFile">Excel-файл (.xlsx, .xls)</label>
    <input id="koptilnyaExcelFile" type="file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
    <div id="koptilnyaImportPreview"></div>
    <div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaImportConfirm" disabled>Импортировать и заменить данные</button><button type="button" class="koptilnyaButton secondary" id="koptilnyaImportCancel">Отмена</button></div>`;
  let parsed = null;
  const preview = body.querySelector('#koptilnyaImportPreview');
  const confirm = body.querySelector('#koptilnyaImportConfirm');
  body.querySelector('#koptilnyaImportCancel').addEventListener('click', () => gate.remove());
  body.querySelector('#koptilnyaExcelFile').addEventListener('change', async (event) => {
    confirm.disabled = true; parsed = null;
    const file = event.target.files?.[0];
    preview.replaceChildren();
    if (!file) return;
    setOverlayStatus('koptilnyaImportGate', 'Читаю листы Excel…');
    try {
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, {type:'array', cellDates:true});
      parsed = parseWorkbook(workbook, file.name);
      lastFileImport = parsed;
      const table = document.createElement('div');
      table.className = 'koptilnyaStatus';
      const rowsHtml = parsed.summary.sheets.map((s) => '<div>' + safeText(s.name) + '<span style="float:right">' + s.rows + ' строк</span></div>').join('');
      table.innerHTML = '<div class="koptilnyaSheetGrid">' + rowsHtml + '</div>';
      preview.appendChild(table);
      const counts = parsed.summary.counts;
      const countBox = document.createElement('div');
      countBox.className = 'koptilnyaStatus';
      countBox.textContent = 'К импорту: продукция ' + counts.products + ', активные контрагенты ' + counts.clients +
        ', документы ' + counts.documents + ', позиции ' + counts.positions + ', затраты ' + counts.expenses +
        ', оплаты ' + counts.payments + ', производственные партии ' + counts.batches + '.';
      preview.appendChild(countBox);
      const annual = document.createElement('table');
      annual.className = 'koptilnyaYearTable';
      annual.innerHTML = '<thead><tr><th>Год</th><th>Выручка</th><th>Себестоимость</th><th>Доп. затраты</th><th>Оплаты</th><th>Выпуск, кг</th></tr></thead><tbody>' +
        [2025,2026].map((year) => {
          const y=parsed.summary.years[year]; return '<tr><td>' + year + '</td><td>' + formatMoney(y.revenue) + '</td><td>' + formatMoney(y.cost) + '</td><td>' + formatMoney(y.expenses) + '</td><td>' + formatMoney(y.payments) + '</td><td>' + y.productionKg.toLocaleString('ru-RU') + '</td></tr>';
        }).join('') + '</tbody>';
      preview.appendChild(annual);
      if (parsed.summary.warnings.length) {
        const warnings = document.createElement('div');
        warnings.className = 'koptilnyaStatus ' + (parsed.summary.warnings.some((w) => /повтор|не удалось|нет отдельных|отсутствует распознаваемая дата/i.test(w)) ? 'error' : '');
        warnings.textContent = 'Проверь перед импортом:\n• ' + parsed.summary.warnings.join('\n• ');
        preview.appendChild(warnings);
      }
      const hasSourceDocs = !!parsed.summary.sourceSheets.documents && counts.documents > 0;
      const blockingWarnings = parsed.summary.warnings.some((w) => /повтор ключа документа|повторяются идентификаторы документов|не удалось определить тип документа|отсутствует распознаваемая дата|сумма позиций документа/i.test(w));
      confirm.disabled = !hasSourceDocs || counts.documents === 0 || blockingWarnings;
      setOverlayStatus('koptilnyaImportGate', confirm.disabled
        ? 'Импорт заблокирован: нужен отдельный лист исходных документов с датами и типами; также исправь критические ошибки сопоставления, показанные выше.'
        : 'Проверь количество строк, контрагентов и суммы за 2025/2026 годы. Следующее нажатие заменит текущие данные.', confirm.disabled ? 'error' : 'ok');
    } catch (error) {
      parsed = null;
      setOverlayStatus('koptilnyaImportGate', 'Не удалось безопасно прочитать файл: ' + (error?.message || 'неизвестный формат'), 'error');
    }
  });
  confirm.addEventListener('click', async () => {
    if (!parsed || confirm.disabled) return;
    const again = window.confirm('Внимание: текущие данные облачной коптильни будут заменены данными из «' + parsed.filename + '». Продолжить? Перед импортом обязательно сохрани ZIP-резервную копию.');
    if (!again) return;
    confirm.disabled = true;
    setOverlayStatus('koptilnyaImportGate', 'Создаю резервную копию и сохраняю импортированную базу…');
    try {
      const nativeBridge = window.KoptilnyaNative;
      if (nativeBridge?.exportFullArchive) {
        await nativeBridge.exportFullArchive({format:'koptilnya-backup',version:2,exportedAt:new Date().toISOString(),application:'Коптильня',contents:app().getState()});
      }
      parsed.state.importHistory = [
        ...(app().getState().importHistory || []),
        {
          fileName: parsed.filename,
          importedAt: new Date().toISOString(),
          sourceSheets: parsed.summary.sourceSheets,
          counts: parsed.summary.counts,
          yearlyTotals: parsed.summary.years,
          warnings: parsed.summary.warnings,
        },
      ];
      revision = Number(revision) || 0;
      const {data, error} = await supabase.rpc('save_organization_data', {
        p_organization_id: organizationId,
        p_expected_revision: revision,
        p_state: parsed.state,
      });
      if (error) throw error;
      revision = Number(data) || revision + 1;
      cloudActive = false;
      app().setState(parsed.state);
      pendingState = null;
      cloudActive = true;
      syncBlocked = false;
      gate.remove();
      setCloudStatus('Импорт сохранён', 'ok');
      toast('Импорт завершён. Проверь отчёты 2025/2026 годов и активный список контрагентов.');
    } catch (error) {
      confirm.disabled = false;
      setOverlayStatus('koptilnyaImportGate', 'Импорт не завершён: ' + (error?.message || 'ошибка сервера') + '. Текущие серверные данные не заменены.', 'error');
    }
  });
};
const reloadRemoteState = async () => {
  if (!supabase || !organizationId) return;
  const {data, error} = await supabase.from('organization_data').select('state,revision').eq('organization_id',organizationId).maybeSingle();
  if (error) { toast(error.message || 'Не удалось перечитать данные', true); return; }
  revision = Number(data?.revision) || 0;
  syncBlocked = false;
  pendingState = null;
  cloudActive = false;
  app()?.setState(data?.state || EMPTY_STATE());
  cloudActive = true;
  setCloudStatus('Обновлено', 'ok');
};

const init = async () => {
  if (!configured) { renderConfigBlocker(); return; }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.KoptilnyaCloud = { queueSave, reload: reloadRemoteState };
  window.addEventListener('koptilnya-state-change', (event) => queueSave(event.detail));
  supabase.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_OUT') {
      cloudActive = false; session = null; user = null; organizationId = null; organizationName = '';
      document.getElementById('koptilnyaCloudBar')?.remove();
      if (supabase) renderAuth('signin');
    } else if (event === 'SIGNED_IN' && nextSession && nextSession.user?.id !== user?.id) {
      queueMicrotask(() => openWorkspace(nextSession));
    } else if (event === 'PASSWORD_RECOVERY' && nextSession) {
      const gate = createOverlay('koptilnyaAuthGate','Новый пароль','Установите новый пароль для своего аккаунта.');
      gate.querySelector('#koptilnyaAuthGateBody').innerHTML = '<form id="koptilnyaNewPassword"><label class="koptilnyaField">Новый пароль</label><input type="password" name="password" minlength="8" required /><div class="koptilnyaActions"><button class="koptilnyaButton">Сохранить пароль</button></div></form>';
      gate.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = new FormData(e.target).get('password');
        const {error: updateError} = await supabase.auth.updateUser({password});
        if (updateError) setOverlayStatus('koptilnyaAuthGate', updateError.message, 'error');
        else { gate.remove(); await openWorkspace(nextSession); }
      });
    }
  });
  const {data, error} = await supabase.auth.getSession();
  if (error) { renderAuth('signin', error.message); return; }
  if (data.session) {
    session = data.session;
    await openWorkspace(data.session);
  } else {
    renderAuth('signin');
  }
};
void init();
