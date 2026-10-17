import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../www/excel-import.js';

const workbook = XLSX.utils.book_new();
const addSheet = (name, rows) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);

addSheet('Продукция', [
  ['ID','Название','Тип','Единица','Остаток','Себестоимость за единицу','Приходная цена','Цена продажи'],
  ['p1','Грудинка','Готовая продукция','кг',0,50,60,100],
  ['p2','Колбаса','Готовая продукция','кг',0,100,120,200],
]);
addSheet('Остатки', [
  ['ID продукции','Продукция','Остаток','Себестоимость за единицу'],
  ['p1','Грудинка',5,50],
  ['p2','Колбаса',7,100],
]);
addSheet('Клиенты', [
  ['ID','Клиент','Телефон','Тип'],
  ['c1','Тортика','','Контрагент'],
  ['c2','Деревенька','','Контрагент'],
  ['c3','Пекарня','','Контрагент'],
  ['c4','Кочевник','','Контрагент'],
  ['c5','Наш','','Контрагент'],
  ['c6','Клиенты цеха','','Контрагент'],
  ['c7','Старый архивный магазин','+7 900 000 00 00','Контрагент'],
]);
addSheet('Документы', [
  ['ID','Дата','Номер','Тип','Клиент/поставщик','Сумма','Себестоимость','Оплачено','Комментарий'],
  ['doc-2025','2025-03-01','R-2025-001','Расходный','Тортика',800,400,400,'Продажа с двумя позициями'],
  ['doc-2026','2026-02-10','S-2026-002','Услуга','Пекарня',500,200,0,'Обработка сырья клиента'],
  ['doc-2024','2024-01-10','R-2024-003','Расходный','Тортика',100,50,0,'Историческая продажа для проверки импорта старых лет'],
]);
addSheet('Позиции', [
  ['Документ ID','Дата','Номер','ID продукции','Продукция','Количество','Цена за единицу','Себестоимость за единицу','Сумма позиции','Себестоимость позиции'],
  ['doc-2025','2025-03-01','R-2025-001','p1','Грудинка',2,100,50,200,100],
  ['doc-2025','2025-03-01','R-2025-001','p2','Колбаса',3,200,100,600,300],
]);
addSheet('Затраты', [
  ['ID','Дата','Категория','Описание','Сумма','Уже включено в себестоимость'],
  ['e1','2025-03-31','Электричество','Вне себестоимости',120,'Нет'],
  ['e2','2025-04-30','Щепа','Уже в себестоимости',50,'Да'],
  ['e3','2026-02-28','Упаковка','Вне себестоимости',70,'Нет'],
]);
addSheet('Оплаты', [
  ['ID','Дата','Клиент','Сумма','Способ','Распределение платежа'],
  ['pay1','2025-03-05','Тортика',400,'Перевод','R-2025-001 — 400'],
]);
addSheet('Партии', [
  ['ID','Дата','Продукт','Сырьё','Исходный вес','Выход','Суммарная себестоимость'],
  ['b1','2026-02-05','Грудинка','Свинина сырьё',4,2,180],
]);
// These are summary/report sheets and must never be treated as operational records.
addSheet('Сводка', [['Показатель','Значение'],['Выручка 2025',999999]]);
addSheet('Продажи', [['Год','Выручка'],[2025,999999]]);
addSheet('Услуги', [['Год','Выручка'],[2026,999999]]);
addSheet('По месяцам', [['Месяц','Выручка'],['2025-03',999999]]);

const parsed = parseWorkbook(workbook, 'koptilnya-fixture.xlsx');
assert.equal(parsed.summary.counts.products, 2, 'Products are read from their source sheet');
assert.equal(parsed.summary.counts.clients, 7, 'All customer rows, including additional historical customers, are imported');
assert.deepEqual(parsed.state.clients.map((c) => c.name).sort(), ['Деревенька','Клиенты цеха','Кочевник','Наш','Пекарня','Старый архивный магазин','Тортика'].sort());
assert.equal(parsed.summary.counts.documents, 3, 'Source documents from every year import; report sheets stay excluded');
assert.equal(parsed.summary.counts.positions, 2, 'Both invoice position rows must survive parsing');
assert.equal(parsed.summary.counts.expenses, 3);
assert.equal(parsed.summary.counts.payments, 1);
assert.equal(parsed.summary.counts.batches, 1);
assert.equal(parsed.state.products.find((p) => p.id === 'p1').stock, 5, 'Inventory balance sheet overrides stale product-list stock');
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2025').items.length, 2);
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2025').manualAmount, undefined, 'Itemized documents should derive totals from positions');
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2026').manualAmount, 500, 'Unitemized service preserves the exact source header total');
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2026').manualCost, 200);
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2024').manualAmount, 100, 'Historical document totals remain available for reports');
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2024').manualCost, 50);
assert.equal(parsed.state.docs.find((d) => d.id === 'doc-2025').paid, 400, 'Payment allocation maps to the specific source document');

assert.equal(parsed.summary.years[2025].revenue, 800);
assert.equal(parsed.summary.years[2025].cost, 400);
assert.equal(parsed.summary.years[2025].expenses, 120, 'Included-in-cost expenses are not subtracted twice');
assert.equal(parsed.summary.years[2025].payments, 400);
assert.equal(parsed.summary.years[2025].docs, 1);
assert.equal(parsed.summary.years[2026].revenue, 500);
assert.equal(parsed.summary.years[2026].cost, 200);
assert.equal(parsed.summary.years[2026].expenses, 70);
assert.equal(parsed.summary.years[2026].productionKg, 2);
assert.equal(parsed.summary.years[2026].docs, 1);
assert.equal(parsed.summary.years[2024].revenue, 100, 'Historical years must be included in summary totals');
assert.equal(parsed.summary.years[2024].cost, 50);
assert.equal(parsed.summary.years[2024].docs, 1);
assert.ok(parsed.state.clients.some((client) => client.name === 'Старый архивный магазин'),
  'Additional client records must be imported instead of silently discarded');

// Legacy-workbook regression: non-standard sheet names, title rows before headers, and alternate Russian column labels.
const legacyWorkbook = XLSX.utils.book_new();
const addLegacySheet = (name, rows) => XLSX.utils.book_append_sheet(legacyWorkbook, XLSX.utils.aoa_to_sheet(rows), name);
addLegacySheet('Номенклатура продукции', [
  ['Экспорт каталога продукции'],
  ['Код товара','Наименование товара','Тип продукции','Ед. измерения','Фактический остаток','Себестоимость за кг','Закупочная цена','Розничная цена'],
  ['p-legacy','Грудинка копчёная','Готовая продукция','кг',12,100,130,240],
]);
addLegacySheet('Справочник клиентов', [
  ['База клиентов'],
  ['ID клиента','ФИО клиента','Мобильный телефон','Тип'],
  ['c-legacy','Мясная лавка','','Магазин'],
]);
addLegacySheet('Журнал документов 2025', [
  ['Архив накладных — данные без изменений'],
  ['ID документа','Дата накладной','Номер накладной','Тип документа','ФИО клиента','Телефон клиента','ID продукции','Продукция','Вес сырья','Итоговая сумма','Полная себестоимость','Оплаченная сумма','Комментарий'],
  ['d-legacy','2025-06-12','НК-2025-18','Продажа','Мясная лавка','8 (900) 123-45-67','p-legacy','Грудинка копчёная',2.5,600,250,300,'Старый документ'],
]);
const legacyParsed = parseWorkbook(legacyWorkbook, 'legacy-export.xlsx');
assert.equal(legacyParsed.summary.counts.products, 1, 'Legacy product sheet with a title row should be recognized');
assert.equal(legacyParsed.summary.counts.clients, 1, 'Legacy customer sheet with alternate headers should be recognized');
assert.equal(legacyParsed.summary.counts.documents, 1, 'Legacy transaction sheet name and prefatory title row should be recognized');
assert.equal(legacyParsed.state.products[0].stock, 12, 'Legacy stock quantity should be imported');
assert.equal(legacyParsed.state.clients[0].name, 'Мясная лавка', 'Legacy client name should be imported');
assert.equal(legacyParsed.state.clients[0].phone, '8 (900) 123-45-67', 'Legacy phone should be imported');
assert.equal(legacyParsed.state.docs[0].number, 'НК-2025-18', 'Legacy invoice number should be imported');
assert.equal(legacyParsed.state.docs[0].items[0].qty, 2.5, 'Legacy document weight should be imported');
assert.equal(legacyParsed.state.docs[0].manualAmount, undefined, 'Legacy itemized summary should be derived from product amount and quantity');
assert.equal(legacyParsed.state.docs[0].customerPhone, '8 (900) 123-45-67', 'Legacy document phone should remain available to CRM');
assert.equal(legacyParsed.summary.years[2025].revenue, 600, 'Legacy historical totals should be retained');
assert.ok(!legacyParsed.summary.warnings.some((warning) => /не удалось определить тип документа|отсутствует распознаваемая дата/i.test(warning)),
  'Legacy transaction should not be blocked because of its sheet/header layout');

console.log('Excel import tests passed: native exports, legacy sheet names, leading title rows, alternate headers, contacts, invoice weights, and historical totals.');
