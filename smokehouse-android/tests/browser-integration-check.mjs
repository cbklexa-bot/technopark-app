import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = process.cwd();
const port = 4173;
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
  env: process.env,
});
let browser;
const fatalPageErrors = [];
async function navigate(page, destination) {
  await page.locator('#menuToggle').click();
  await page.locator('.side [data-page="' + destination + '"]').click();
}
async function submitAndWait(page) {
  await page.locator('#form button[type="submit"]').click();
  await page.waitForFunction(() => !document.getElementById('back').classList.contains('open'), null, { timeout: 7000 });
}
async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.KoptilnyaApp && window.KoptilnyaNative && window.KoptilnyaLocal), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('koptilnyaLicenseGate'), null, { timeout: 7000 });
}
function assertRectsEqual(rects, label) {
  assert.ok(rects.length > 1, label + ': cards not found');
  const heights = rects.map((r) => r.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 2, label + ': card heights differ: ' + heights.join(','));
}
async function checkDashboard(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(origin + '/index.html');
  await waitForApp(page);
  const result = await page.evaluate(() => {
    const home = document.getElementById('page-home');
    const finance = home.querySelector('.finance-panel').getBoundingClientRect();
    const actions = home.querySelector('.home-actions').getBoundingClientRect();
    const metrics = Array.from(home.querySelectorAll('.home-metrics .card')).map((node) => {
      const r = node.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom,
        children:Array.from(node.querySelectorAll('.label,.value,.sub')).map((c) => ({
          text:c.textContent.trim(),left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right,
          top:c.getBoundingClientRect().top,bottom:c.getBoundingClientRect().bottom,
          scrollWidth:c.scrollWidth,clientWidth:c.clientWidth,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight
        })) };
    });
    const quick = Array.from(home.querySelectorAll('.quickgrid .quick')).map((node) => {
      const r=node.getBoundingClientRect();
      return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,
        children:Array.from(node.querySelectorAll('b,small')).map((c) => ({
          text:c.textContent.trim(),left:c.getBoundingClientRect().left,right:c.getBoundingClientRect().right,
          top:c.getBoundingClientRect().top,bottom:c.getBoundingClientRect().bottom,
          scrollWidth:c.scrollWidth,clientWidth:c.clientWidth,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight
        })) };
    });
    return { finance:{y:finance.y,height:finance.height,bottom:finance.bottom},
      actions:{y:actions.y,height:actions.height,bottom:actions.bottom},
      metrics,quick,docHeight:document.documentElement.scrollHeight,viewportHeight:window.innerHeight };
  });
  assert.equal(result.metrics.length, 3, 'Dashboard needs exactly three finance cards: revenue, debts, costs');
  assert.equal(result.quick.length, 6, 'Dashboard needs six quick actions');
  assertRectsEqual(result.metrics, 'Three finance metrics at ' + width + 'x' + height);
  assertRectsEqual(result.quick, 'Quick actions at ' + width + 'x' + height);
  const ratio=result.finance.height/(result.finance.height+result.actions.height);
  assert.ok(ratio >= 0.37 && ratio <= 0.43, 'Finance/action blocks are not 40/60 at ' + width + 'x' + height + ': ' + ratio.toFixed(3));
  assert.ok(result.docHeight <= result.viewportHeight + 2, 'Dashboard overflows viewport at ' + width + 'x' + height);
  for (const card of [...result.metrics,...result.quick]) {
    assert.ok(card.x >= -1 && card.y >= -1 && card.right <= width + 1 && card.bottom <= height + 1, 'Dashboard card exceeds viewport at ' + width + 'x' + height + ': ' + JSON.stringify({x:card.x,y:card.y,right:card.right,bottom:card.bottom,width:card.width,height:card.height,content:card.children.map(c=>c.text)}));
    for (const child of card.children) {
      assert.ok(child.left >= card.x - 1 && child.right <= card.right + 1, 'Text overflows card horizontally: ' + child.text);
      assert.ok(child.top >= card.y - 1 && child.bottom <= card.bottom + 1, 'Text overflows card vertically at ' + width + 'x' + height + ': ' + child.text + ' child=' + JSON.stringify({top:child.top,bottom:child.bottom,height:child.bottom-child.top}) + ' card=' + JSON.stringify({top:card.y,bottom:card.bottom,height:card.height}));
      assert.ok(child.scrollWidth <= child.clientWidth + 2, 'Text is clipped horizontally: ' + child.text);
      assert.ok(child.scrollHeight <= child.clientHeight + 3, 'Text is clipped vertically: ' + child.text);
    }
  }
}
async function main() {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  // Dashboard layout is tested on more than one mobile viewport before the data workflows.
  const layoutContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const layoutPage = await layoutContext.newPage();
  layoutPage.on('pageerror', (e) => fatalPageErrors.push(String(e)));
  await checkDashboard(layoutPage, 390, 844);
  await checkDashboard(layoutPage, 360, 740);
  await checkDashboard(layoutPage, 320, 640);
  await layoutContext.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => fatalPageErrors.push(String(e)));
  await page.goto(origin + '/index.html');
  await waitForApp(page);

  // 1. Client creation, list rendering, and persistence.
  const clientName = 'E2E клиент сохранение';
  await navigate(page, 'clients');
  await page.locator('#page-clients [data-action="client"]').click();
  await page.locator('#form [name="name"]').fill(clientName);
  await page.locator('#form [name="phone"]').fill('+37060012345');
  await submitAndWait(page);
  await page.locator('#clientCrmMetrics .card').first().click();
  await page.locator('#clientDirectoryModal').getByText(clientName, { exact: true }).waitFor();
  await page.locator('#clientDirectoryModal [data-client-history]').filter({ hasText: clientName }).click();
  await page.locator('#clientDetailModal').getByText(clientName, { exact: false }).waitFor();
  await page.locator('#closeClientDetail').click();

  // 2. Expense creation and financial/report refresh.
  await navigate(page, 'expenses');
  await page.locator('#page-expenses [data-action="expense"]').click();
  await page.locator('#form [name="category"]').fill('E2E затрата');
  await page.locator('#form [name="amount"]').fill('123');
  await submitAndWait(page);
  await page.locator('#expensesTable').getByText('E2E затрата', { exact: true }).waitFor();

  // 3. Service template creation.
  await navigate(page, 'settings');
  await page.locator('#page-settings [data-action="servicePreset"]').click();
  await page.locator('#form [name="name"]').fill('E2E копчение');
  await page.locator('#form [name="price"]').fill('250');
  await page.locator('#form [name="cost"]').fill('100');
  await submitAndWait(page);
  await page.locator('#servicePresetsList').getByText('E2E копчение', { exact: true }).waitFor();

  // Prepare a product for the receipt and sale scenarios.
  await navigate(page, 'products');
  await page.locator('#page-products [data-action="product"]').click();
  await page.locator('#form [name="name"]').fill('E2E курица');
  await page.locator('#form [name="stock"]').fill('0');
  await page.locator('#form [name="cost"]').fill('300');
  await page.locator('#form [name="sale"]').fill('500');
  await submitAndWait(page);
  await page.locator('#productsGrid').getByText('E2E курица', { exact: true }).waitFor();

  // 4. Receipt creates a document and changes stock.
  await navigate(page, 'home');
  await page.locator('#page-home .quick[data-action="receipt"]').click();
  await page.locator('#back.open').waitFor();
  if (await page.locator('#receiptLines .sale-line').count() === 0) {
    await page.locator('#addReceiptLine').click();
    await page.locator('#productPicker [data-pick-product]').filter({ hasText: 'E2E курица' }).click();
  }
  await page.locator('#form [name="receiptProduct"]').selectOption({ label: 'E2E курица' });
  await page.locator('#form [name="receiptQty"]').fill('10');
  await page.locator('#form [name="receiptCost"]').fill('300');
  await submitAndWait(page);
  let state = await page.evaluate(() => window.KoptilnyaApp.getState());
  let product = state.products.find((p) => p.name === 'E2E курица');
  assert.equal(product.stock, 10, 'Receipt must increase stock to 10 kg');
  assert.ok(state.docs.some((d) => d.type === 'receipt' && d.items.some((i) => i.productId === product.id)), 'Receipt document should exist');

  // 5. Sale/expense document is saved and stock is reduced correctly.
  await navigate(page, 'home');
  await page.locator('#page-home .quick[data-action="sale"]').click();
  await page.locator('#back.open').waitFor();
  if (await page.locator('#saleLines .sale-line').count() === 0) {
    await page.locator('#addSaleLine').click();
    await page.locator('#productPicker [data-pick-product]').filter({ hasText: 'E2E курица' }).click();
  }
  await page.locator('#form [name="clientId"]').selectOption({ label: clientName });
  await page.locator('#form [name="lineProduct"]').selectOption({ label: 'E2E курица' });
  await page.locator('#form [name="lineQty"]').fill('2');
  await page.locator('#form [name="linePrice"]').fill('500');
  await submitAndWait(page);
  state = await page.evaluate(() => window.KoptilnyaApp.getState());
  product = state.products.find((p) => p.name === 'E2E курица');
  assert.equal(product.stock, 8, 'Sale must decrease stock from 10 kg to 8 kg');
  const saleDoc = state.docs.find((d) => d.type === 'sale' && d.clientId === state.clients.find((c) => c.name === 'E2E клиент сохранение').id);
  assert.ok(saleDoc, 'Sale document should be linked to the client');
  const originalSaleAmount = saleDoc.items.reduce((sum, item) => sum + Number(item.qty) * Number(item.price), 0);

  // Editing an old invoice must switch payment status both ways without changing its financial values or stock.
  await navigate(page, 'documents');
  await page.locator('[data-edit-doc="' + saleDoc.id + '"]').click();
  await page.locator('#form [name="paid"]').selectOption('all');
  await submitAndWait(page);
  state = await page.evaluate(() => window.KoptilnyaApp.getState());
  let editedSale = state.docs.find((d) => d.id === saleDoc.id);
  assert.equal(Number(editedSale.paid), originalSaleAmount, 'Marking an invoice paid must update its paid amount');
  await page.locator('[data-edit-doc="' + saleDoc.id + '"]').click();
  await page.locator('#form [name="paid"]').selectOption('0');
  await submitAndWait(page);
  state = await page.evaluate(() => window.KoptilnyaApp.getState());
  editedSale = state.docs.find((d) => d.id === saleDoc.id);
  assert.equal(Number(editedSale.paid), 0, 'Marking an invoice unpaid must clear the paid amount');
  assert.equal(state.products.find((p) => p.name === 'E2E курица').stock, 8, 'Payment-status edits must not change stock');
  assert.equal(editedSale.items.reduce((sum, item) => sum + Number(item.qty) * Number(item.price), 0), originalSaleAmount, 'Payment-status edits must not change sale totals');
  await navigate(page, 'debts');
  await page.locator('#debtsTable').getByText(saleDoc.number, { exact: true }).waitFor();
  

  // 6. Service from a client's raw material creates a service document with computed amount.
  await navigate(page, 'home');
  await page.locator('#page-home .quick[data-action="service"]').click();
  await page.locator('#back.open').waitFor();
  await page.locator('#form #servicePresetSelect').selectOption({ label: 'E2E копчение' });
  await page.locator('#form [name="qty"]').fill('3');
  await page.locator('#form [name="phone"]').fill('+37060012345');
  await submitAndWait(page);
  state = await page.evaluate(() => window.KoptilnyaApp.getState());
  const service = state.docs.find((d) => d.type === 'service' && d.serviceName === 'E2E копчение');
  assert.ok(service, 'Client-raw-material service document should be saved');
  assert.equal(service.qty, 3);
  assert.equal(service.price, 250);
  assert.equal(service.cost, 100);

  // 7. Phone search suggestions, service/sale client detail, and arbitrary date range.
  await navigate(page, 'clients');
  await page.locator('#clientSearchInput').fill('+37060012345');
  await page.locator('#clientSearchResults [data-client-history]').filter({ hasText: clientName }).waitFor();
  await page.locator('#clientSearchResults [data-client-history]').filter({ hasText: clientName }).click();
  await page.locator('#clientDetailModal').waitFor();
  await page.locator('#clientDetailContent').getByText('E2E копчение', { exact: true }).waitFor();
  await page.locator('#closeClientDetail').click();
  const today = new Date().toISOString().slice(0, 10);
  await page.locator('#clientStatsPeriod').selectOption('custom');
  await page.locator('#clientRangeStart').fill(today);
  await page.locator('#clientRangeEnd').fill(today);
  await page.locator('#applyClientRange').click();
  await page.locator('#clientCrmMetrics').getByText('Обращений за период').waitFor();
  const serviceCountText = await page.locator('#clientCrmMetrics .card').nth(2).innerText();
  assert.match(serviceCountText, /1/, 'Custom date range should count the service created today');

  // 8. Validation and failed persistent storage must leave the form open and entered values intact.
  await navigate(page, 'clients');
  await page.locator('#page-clients [data-action="client"]').click();
  await page.locator('#form [name="name"]').fill('');
  await page.locator('#form button[type="submit"]').click();
  await page.locator('#back.open').waitFor();
  assert.match(await page.locator('#toast').innerText(), /Проверьте поле|Не удалось сохранить/);
  await page.locator('#form [name="name"]').fill('E2E отказ записи');
  await page.evaluate(() => {
    window.__realBusinessSave = window.KoptilnyaNative.saveBusinessState;
    window.KoptilnyaNative.saveBusinessState = async () => { throw new Error('TEST_STORAGE_FAILURE'); };
  });
  await page.locator('#form button[type="submit"]').click();
  await page.locator('#back.open').waitFor();
  assert.equal(await page.locator('#form [name="name"]').inputValue(), 'E2E отказ записи', 'Input must remain available after storage failure');
  assert.match(await page.locator('#toast').innerText(), /TEST_STORAGE_FAILURE|Не удалось подтвердить запись/);
  state = await page.evaluate(() => window.KoptilnyaApp.getState());
  assert.ok(!state.clients.some((c) => c.name === 'E2E отказ записи'), 'Failed save must roll back the in-memory record');
  await page.evaluate(() => { window.KoptilnyaNative.saveBusinessState = window.__realBusinessSave; });

  // Reload and read the actual durable store, independently of the visible UI cache.
  await page.reload();
  await waitForApp(page);
  const durable = await page.evaluate(async () => {
    const stored = await window.KoptilnyaNative.loadBusinessState();
    if (!stored || stored.found !== true || !stored.state) throw new Error('Durable store has no saved business state');
    return JSON.parse(stored.state);
  });
  assert.ok(durable.clients.some((c) => c.name === clientName), 'Client must survive reload in durable store');
  assert.ok(durable.expenses.some((e) => e.category === 'E2E затрата' && Number(e.amount) === 123), 'Expense must survive reload');
  assert.ok(durable.servicePresets.some((p) => p.name === 'E2E копчение' && Number(p.price) === 250), 'Service template must survive reload');
  assert.ok(durable.docs.some((d) => d.type === 'receipt'), 'Receipt must survive reload');
  assert.ok(durable.docs.some((d) => d.type === 'sale'), 'Sale must survive reload');
  assert.ok(durable.docs.some((d) => d.type === 'service' && d.serviceName === 'E2E копчение'), 'Service must survive reload');
  assert.ok(!durable.clients.some((c) => c.name === 'E2E отказ записи'), 'Rejected write must not appear after reload');

  assert.deepEqual(fatalPageErrors, [], 'No uncaught browser exceptions should occur: ' + fatalPageErrors.join(' | '));
  await context.close();
  console.log('Browser integration passed: dashboard viewports; client, expense, service template, raw-material service, receipt, sale; durable reload; validation and storage-failure rollback.');
}
try {
  // Wait until Vite preview is ready without requiring any external network service.
  const probe = await import('node:http');
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = probe.get(origin + '/index.html', (res) => { res.resume(); res.statusCode < 500 ? resolve() : reject(new Error('preview HTTP ' + res.statusCode)); });
        req.on('error', reject);
        req.setTimeout(500, () => { req.destroy(new Error('preview timeout')); });
      });
      ready = true; break;
    } catch { await delay(250); }
  }
  if (!ready) throw new Error('Vite preview did not start on port ' + port);
  await main();
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}