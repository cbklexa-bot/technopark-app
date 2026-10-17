import * as XLSX from 'xlsx';

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
const HEADER_MARKERS = new Set([
  'id','ид','idпродукции','idдокумента','номер','номердокумента','дата','датадокумента',
  'тип','виддокумента','операция','название','наименование','наименованиетовара','продукция',
  'товар','товары','номенклатура','клиент','контрагент','покупатель','заказчик','имяклиента',
  'телефон','номертелефона','мобильныйтелефон','единица','единицаизмерения','количество',
  'количествокг','колвокг','колво','вес','вессырья','остаток','фактическийостаток','сумма','итого','итоговаясумма','общаясумма','цена',
  'ценапродажи','закупочнаяцена','розничнаяцена','себестоимость','себестоимостьзагкг','едизмерения','кодтовара',
  'наименованиетовара','типпродукции','датанакладной','номернакладной','номернакладной','фиоклиента','оплачено','оплаченнаясумма',
  'долг','категория','статья','описание','комментарий','примечание','сырье','выход','выпуск','суммаплатежа','способоплаты',
].map(norm));
const arrayRows = (workbook, sheetName) => {
  if (!sheetName || !workbook.Sheets[sheetName]) return [];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  let headerRow = 0;
  for (let index = 0; index < Math.min(8, matrix.length); index++) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    const markers = row.filter((value) => HEADER_MARKERS.has(norm(value))).length;
    if (markers >= 2) { headerRow = index; break; }
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true, range: headerRow, blankrows: false });
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
  if (text.includes('услуг') || text.includes('обработ') || text.includes('копчен') || text.includes('переработ') || text.includes('service')) return 'service';
  if (text.includes('продаж') || text.includes('расход') || text.includes('реализац') || text.includes('sale')) return 'sale';
  return '';
};
const findSheet = (workbook, aliases) => {
  const normalizedAliases = aliases.map(norm).filter(Boolean);
  const wanted = new Set(normalizedAliases);
  const exact = workbook.SheetNames.find((name) => wanted.has(norm(name)));
  if (exact) return exact;
  const excludedSummaryNames = new Set([
    'сводка','итоги','итог','отчет','отчеты','финансовыйотчет','помесяцам',
    'продажи','услуги','файлы','summary','salesreport','servicesreport',
  ]);
  return workbook.SheetNames.find((name) => {
    const candidate = norm(name);
    if (!candidate || excludedSummaryNames.has(candidate)) return false;
    return normalizedAliases.some((alias) => alias.length >= 5 && (candidate.startsWith(alias) || candidate.endsWith(alias)));
  }) || '';
};
const parseWorkbook = (workbook, filename) => {
  const sourceNames = {
    products: findSheet(workbook, ['Продукция', 'Товары', 'Список товаров', 'Номенклатура', 'Товары и услуги', 'Справочник продукции', 'Products']),
    stock: findSheet(workbook, ['Остатки', 'Остатки продукции', 'Остатки товаров', 'Склад', 'Складские остатки', 'Stock balances']),
    clients: findSheet(workbook, ['Клиенты', 'Контрагенты', 'Покупатели', 'Заказчики', 'Справочник клиентов', 'Список клиентов', 'Clients']),
    documents: findSheet(workbook, ['Документы', 'Документы клиентов', 'Журнал документов', 'История документов', 'Накладные', 'Накладные клиентов', 'Расходные накладные', 'Журнал операций', 'Операции учёта', 'Documents']),
    positions: findSheet(workbook, ['Позиции', 'Позиции накладных', 'Состав накладных', 'Состав документов', 'Строки документов', 'Товары в накладных', 'Document items']),
    expenses: findSheet(workbook, ['Затраты', 'Расходы', 'Расходы предприятия', 'Журнал затрат', 'Статьи расходов', 'Expenses']),
    payments: findSheet(workbook, ['Оплаты', 'Платежи', 'Поступления оплат', 'Платежи клиентов', 'История оплат', 'Payments']),
    batches: findSheet(workbook, ['Партии', 'Производство', 'Выпуск', 'Выпуск продукции', 'Производство и выпуск', 'Производственные партии', 'Production']),
    checksums: findSheet(workbook, ['Контрольные суммы и расхождения', 'Контрольные суммы', 'Сверка']),
  };
  const rawProducts = arrayRows(workbook, sourceNames.products);
  const rawStock = arrayRows(workbook, sourceNames.stock);
  const rawClients = arrayRows(workbook, sourceNames.clients);
  const rawChecksums = arrayRows(workbook, sourceNames.checksums);
  const rawDocs = arrayRows(workbook, sourceNames.documents);
  const rawPositions = arrayRows(workbook, sourceNames.positions);
  const rawExpenses = arrayRows(workbook, sourceNames.expenses);
  const rawPayments = arrayRows(workbook, sourceNames.payments);
  const rawBatches = arrayRows(workbook, sourceNames.batches);
  const warnings = [];
  if (!sourceNames.documents && !sourceNames.positions) {
    warnings.push('Нет отдельных исходных листов «Документы» и «Позиции». Агрегированные листы «Продажи», «Услуги» и «По месяцам» не импортируются как операции, чтобы не посчитать выручку повторно.');
  }
  if (!sourceNames.products && !sourceNames.stock) warnings.push('Не найден лист продукции или остатков. Без него нельзя достоверно связать позиции с карточками товаров.');
  if (sourceNames.checksums && !rawChecksums.length) warnings.push('Лист сверки найден, но в нём не распознаны строки. Проверьте содержимое вручную.');
  const products = rawProducts.map((r) => {
    const rawType = clean(headerValue(r, ['Тип', 'Тип продукции', 'Категория', 'Вид продукции', 'Группа']));
    let type = 'Готовая продукция';
    if (norm(rawType).includes('сыр')) type = 'Сырьё';
    else if (norm(rawType).includes('полу')) type = 'Полуфабрикат';
    else if (norm(rawType).includes('услуг')) type = 'Услуга';
    return {
      id: stableId(headerValue(r, ['ID', 'ID продукции', 'ID товара', 'Код товара', 'Артикул', 'Product ID']), 'import-product'),
      name: clean(headerValue(r, ['Название', 'Название товара', 'Название продукта', 'Наименование', 'Наименование товара', 'Наименование продукции', 'Продукция', 'Товар', 'Номенклатура', 'Product'])),
      type,
      emoji: '',
      unit: clean(headerValue(r, ['Единица', 'Единица измерения', 'Ед.изм.', 'Ед. измерения', 'Ед.'])) || 'кг',
      stock: num(headerValue(r, ['Остаток', 'Количество', 'Остаток, кг', 'Количество на складе', 'Фактический остаток', 'Остатки', 'Наличие'])),
      cost: num(headerValue(r, ['Себестоимость за единицу', 'Себестоимость единицы', 'Себестоимость за кг', 'Себестоимость', 'Средняя себестоимость', 'Себестоимость/кг'])),
      receipt: num(headerValue(r, ['Приходная цена', 'Цена прихода', 'Цена закупки', 'Закупочная цена', 'Закупка за единицу', 'Цена закупки за кг'])),
      sale: num(headerValue(r, ['Цена продажи', 'Цена реализации', 'Продажная цена', 'Розничная цена', 'Цена за единицу', 'Цена'])),
      image: '',
    };
  }).filter((p) => p.name);
  const productNames = new Map();
  products.forEach((p) => { const key = norm(p.name); if (key && !productNames.has(key)) productNames.set(key, p.id); });
  rawStock.forEach((r, index) => {
    const name = clean(headerValue(r, ['Продукция', 'Название', 'Наименование', 'Товар', 'Продукт']));
    const sourceId = clean(headerValue(r, ['ID', 'ID продукции', 'ID товара', 'Код товара', 'Артикул', 'Product ID']));
    if (!name) return;
    let product = (sourceId ? products.find((p) => p.id === sourceId) : null) || products.find((p) => norm(p.name) === norm(name));
    if (!product) {
      product = {
        id: sourceId || stableId('', 'import-stock-' + index), name,
        type: 'Готовая продукция', emoji: '', unit: clean(headerValue(r, ['Единица', 'Ед.изм.', 'Ед.'])) || 'кг',
        stock: 0, cost: num(headerValue(r, ['Себестоимость за единицу', 'Себестоимость', 'Себестоимость/кг'])),
        receipt: num(headerValue(r, ['Приходная цена', 'Цена закупки'])),
        sale: num(headerValue(r, ['Цена продажи', 'Цена реализации'])), image: '',
      };
      products.push(product);
      productNames.set(norm(name), product.id);
      warnings.push('В продукции не найден товар «' + name + '» с листа остатков. Добавлена карточка по исходному названию; проверьте её тип и цены.');
    }
    product.stock = num(headerValue(r, ['Остаток', 'Количество', 'Остаток, кг', 'Количество на складе', 'Фактический остаток']));
  });
  rawChecksums.forEach((r) => {
    const status = clean(headerValue(r, ['Статус', 'Результат проверки', 'Расхождение', 'Проверка']));
    if (status && /расхожд|ошибк|не совпад|не сход|неверн/i.test(status)) {
      warnings.push('Лист сверки содержит контрольную запись «' + status + '». Проверьте её до импорта.');
    }
  });

  const activeClientByName = new Map();
  const clients = [];
  const addImportedClient = (nameValue, row, prefix) => {
    const name = clean(nameValue);
    if (!name) return null;
    const key = norm(name);
    if (activeClientByName.has(key)) {
      const existing = clients.find((client) => client.id === activeClientByName.get(key));
      if (row) warnings.push('Повтор названия клиента «' + name + '» на листе «' + sourceNames.clients + '». Сохранена первая запись; проверьте дубликаты.');
      return existing || null;
    }
    const client = {
      id: stableId(row ? headerValue(row, ['ID', 'ID клиента', 'ID контрагента', 'Код клиента', 'Client ID']) : '', prefix || 'import-client'),
      name,
      phone: row ? clean(headerValue(row, ['Телефон', 'Номер телефона', 'Телефон клиента', 'Мобильный', 'Мобильный телефон', 'Сотовый телефон', 'Контактный телефон', 'Тел.', 'Phone'])) : '',
      kind: (row ? clean(headerValue(row, ['Тип', 'Вид', 'Категория'])) : '') || 'Контрагент',
    };
    clients.push(client);
    activeClientByName.set(key, client.id);
    return client;
  };
  if (!sourceNames.clients) warnings.push('В книге не найден лист «Клиенты/Контрагенты». Карточки клиентов будут созданы по именам из документов, если они есть.');
  rawClients.forEach((row) => {
    addImportedClient(headerValue(row, ['Клиент', 'Контрагент', 'Название', 'Наименование', 'Покупатель', 'Имя клиента', 'ФИО клиента', 'Код клиента', 'Заказчик', 'Name']), row, 'import-client');
  });
  // Recover clients named on invoices even if the source workbook's client list is missing or incomplete.
  rawDocs.forEach((row) => {
    const type = rowDocType(headerValue(row, ['Тип', 'Тип документа', 'Вид', 'Вид документа', 'Операция', 'Тип операции']), sourceNames.documents);
    if (type === 'receipt') return;
    const name = clean(headerValue(row, ['Клиент/поставщик', 'Клиент', 'Имя клиента', 'ФИО клиента', 'Контрагент', 'Поставщик', 'Покупатель', 'Заказчик', 'Наименование клиента']));
    if (!name) return;
    const key = norm(name);
    const client = activeClientByName.has(key)
      ? clients.find((item) => item.id === activeClientByName.get(key))
      : addImportedClient(name, null, 'import-client-from-document');
    const phone = clean(headerValue(row, ['Телефон', 'Номер телефона', 'Телефон клиента', 'Мобильный', 'Мобильный телефон', 'Сотовый телефон', 'Контактный телефон', 'Тел.']));
    if (client && phone && !client.phone) client.phone = phone;
  });

  const rowKey = (r) => {
    const explicitId = clean(headerValue(r, ['ID', 'ID документа', 'Документ ID', 'Document ID']));
    const number = clean(headerValue(r, ['Номер', 'Номер документа', 'Номер накладной', 'Номер операции', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Дата операции', 'Дата накладной', 'Дата создания', 'Date']));
    return explicitId ? 'id:' + explicitId : (number ? 'number:' + norm(number) + '|' + date : '');
  };
  const docMap = new Map();
  const docs = [];
  const importedDocKeys = new Set();
  rawDocs.forEach((r, index) => {
    const number = clean(headerValue(r, ['Номер', 'Номер документа', 'Номер накладной', 'Номер операции', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Дата операции', 'Дата накладной', 'Дата создания', 'Date']));
    const key = rowKey(r) || 'row:' + index;
    if (importedDocKeys.has(key)) warnings.push('Повтор ключа документа «' + (number || key) + '» в исходном листе. Эти записи не объединяются автоматически.');
    importedDocKeys.add(key);
    const type = rowDocType(headerValue(r, ['Тип', 'Тип документа', 'Вид', 'Вид документа', 'Операция', 'Тип операции']), sourceNames.documents);
    if (!type) {
      warnings.push('Не удалось определить тип документа «' + (number || key) + '». Строка не импортирована.');
      return;
    }
    const counterpartyName = clean(headerValue(r, ['Клиент/поставщик', 'Клиент', 'Имя клиента', 'ФИО клиента', 'Контрагент', 'Поставщик', 'Покупатель', 'Заказчик', 'Наименование клиента']));
    const clientId = activeClientByName.get(norm(counterpartyName)) || '';
    const id = stableId(headerValue(r, ['ID', 'ID документа', 'Document ID']), 'import-doc-' + index);
    const amount = num(headerValue(r, ['Сумма', 'Итого', 'Итоговая сумма', 'Общая сумма', 'Сумма документа', 'Сумма накладной', 'Выручка', 'Всего']));
    const cost = num(headerValue(r, ['Себестоимость', 'Сумма себестоимости', 'Себестоимость документа', 'Полная себестоимость', 'Себестоимость накладной']));
    const rawPaid = headerValue(r, ['Оплачено', 'Оплаченная сумма', 'Оплата', 'Сумма оплат', 'Сумма оплаты', 'Уплачено']);
    const doc = {
      id,
      date,
      number: number || ('ИМП-' + (index + 1)),
      type,
      clientId,
      customerName: clean(headerValue(r, ['Имя клиента', 'ФИО клиента', 'Клиент', 'Контрагент', 'Покупатель', 'Заказчик'])),
      customerPhone: clean(headerValue(r, ['Телефон', 'Номер телефона', 'Телефон клиента', 'Мобильный', 'Мобильный телефон', 'Сотовый телефон', 'Контактный телефон', 'Тел.'])),
      supplier: type === 'receipt' ? counterpartyName : (!clientId ? counterpartyName : ''),
      note: clean(headerValue(r, ['Комментарий', 'Примечание', 'Описание', 'Заметка', 'Примечания', 'Примечание документа'])),
      qty: num(headerValue(r, ['Количество', 'Кол-во', 'Колво', 'Количество, кг', 'Вес', 'Вес, кг', 'Вес сырья', 'Принято сырья, кг', 'Объём, кг', 'Кол-во кг'])),
      paid: num(rawPaid),
      items: [],
      sourceRow: index + 2,
    };
    // Preserve records from every year; historical information is needed for reports and reconciliation.
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
    const explicitId = clean(headerValue(r, ['Документ ID', 'ID документа', 'Код документа', 'Document ID']));
    const number = clean(headerValue(r, ['Номер', 'Номер документа', 'Номер накладной', 'Номер операции', '№', 'Документ']));
    const date = dateISO(headerValue(r, ['Дата', 'Дата документа', 'Дата операции', 'Дата накладной', 'Дата создания', 'Date']));
    let doc = explicitId ? docMap.get('id:' + explicitId) : null;
    if (!doc && number) doc = byNumberAndDate.get(norm(number) + '|' + date) || docs.find((d) => norm(d.number) === norm(number));
    if (!doc) {
      warnings.push('Строка позиции №' + (index + 2) + ' не сопоставлена документу; она не импортирована.');
      return;
    }
    if (doc.items.length === 0) { delete doc.manualAmount; delete doc.manualCost; }
    const productName = clean(headerValue(r, ['Продукция', 'Наименование продукции', 'Наименование товара', 'Название товара', 'Номенклатура', 'Товар', 'Product']));
    const sourceProductId = clean(headerValue(r, ['ID продукции', 'Продукция ID', 'Product ID']));
    const productId = products.some((p) => p.id === sourceProductId) ? sourceProductId : productNames.get(norm(productName));
    const qty = num(headerValue(r, ['Количество', 'Кол-во', 'Колво', 'Количество, кг', 'Кол-во кг', 'Вес', 'Вес, кг', 'Вес сырья', 'Принято сырья, кг', 'Qty']));
    const price = num(headerValue(r, ['Цена за единицу', 'Цена за кг', 'Цена', 'Цена продажи', 'Сумма за единицу']));
    const lineAmount = num(headerValue(r, ['Сумма позиции', 'Сумма', 'Итого']));
    const lineCost = num(headerValue(r, ['Себестоимость позиции', 'Себестоимость', 'Сумма себестоимости']));
    const unitCost = num(headerValue(r, ['Себестоимость за единицу', 'Себестоимость/кг']));
    if (qty <= 0 || (!productId && !productName)) {
      warnings.push('Позиция документа «' + doc.number + '» не содержит однозначного товара или положительного количества.');
      return;
    }
    if (!productId) warnings.push('В позиции документа «' + doc.number + '» товар «' + productName + '» не сопоставлен активной карточке продукции. Количество и суммы сохранены в позиции как исторический снимок названия.');
    doc.items.push({
      productId: productId || '',
      qty,
      price: price || (qty ? lineAmount / qty : 0),
      cost: unitCost || (qty ? lineCost / qty : 0),
      note: productId ? '' : productName,
    });
  });

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

  const docsByNumber = new Map();
  docs.forEach((d) => {
    const key = norm(d.number);
    if (!docsByNumber.has(key)) docsByNumber.set(key, []);
    docsByNumber.get(key).push(d);
  });
  const ambiguousDocNumbers = new Set([...docsByNumber.entries()].filter(([, matches]) => matches.length > 1).map(([key]) => key));
  rawPayments.forEach((r) => {
    const allocationText = clean(headerValue(r, ['Распределение платежа', 'Распределение', 'По документам', 'Накладные']));
    for (const part of allocationText.split(/[;\n]+/)) {
      const pieces = part.split(/\s[—–-]\s/);
      if (pieces.length >= 2 && ambiguousDocNumbers.has(norm(pieces[0]))) {
        warnings.push('Платёж с распределением по «' + pieces[0] + '» невозможно однозначно связать: номер документа повторяется в разных строках истории. Укажите дату/ID документа или исправьте распределение до импорта.');
      }
    }
  });
  const docByNumber = new Map([...docsByNumber.entries()].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
  const expenses = rawExpenses.map((r, index) => {
    const date = dateISO(headerValue(r, ['Дата', 'Дата затрат', 'Date']));
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
    const clientName = clean(headerValue(r, ['Клиент', 'Имя клиента', 'ФИО клиента', 'Контрагент', 'Покупатель', 'Заказчик']));
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
      amount: num(headerValue(r, ['Сумма', 'Платёж', 'Сумма платежа', 'Сумма оплаты', 'Amount'])),
      method: clean(headerValue(r, ['Способ', 'Способ оплаты', 'Метод оплаты', 'Тип оплаты'])) || 'Не указан',
      allocations,
      note: clean(headerValue(r, ['Комментарий', 'Примечание'])),
    };
  }).filter((p) => p && p.amount > 0);

  const batches = rawBatches.map((r, index) => {
    const date = dateISO(headerValue(r, ['Дата', 'Дата производства', 'Date']));
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
  const yearSet = new Set();
  [...docs, ...expenses, ...payments, ...batches].forEach((record) => {
    const year = Number(String(record.date || '').slice(0, 4));
    if (Number.isInteger(year) && year >= 1900 && year <= 9999) yearSet.add(year);
  });
  [...yearSet].sort((a, b) => a - b).forEach((year) => {
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
  const activeClientSet = new Set(clients.map((client) => client.id));
  if (docs.some((d) => d.clientId && !activeClientSet.has(d.clientId))) warnings.push('В истории есть документы со ссылками на отсутствующих клиентов. Проверьте справочник клиентов после импорта.');
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


const formatMoney = (value) => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',maximumFractionDigits:0}).format(num(value));

export {
  clean, norm, num, stableId, arrayRows, headerValue, dateISO,
  amountForState, costForState, rowDocType, findSheet, parseWorkbook,
};
