import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'www', 'index.html'), 'utf8');

assert.ok(
  html.includes('.section#page-clients > .head .client-actions .btn{'),
  'The Add Client button must have a viewport-safe mobile layout'
);
assert.ok(
  html.includes('class="client-directory-row"') &&
  html.includes('client-directory-delete') &&
  html.includes('data-delete-client='),
  'The client directory must show a separate delete action'
);
assert.ok(
  html.includes('function activeClients(){return s.clients.filter(function(x){return !x.removedFromDirectory})}'),
  'Removed clients must be excluded from the active directory'
);

const start = html.indexOf('async function deleteClient(clientId){');
const end = html.indexOf('\nfunction resolveServiceClient', start);
assert.ok(start >= 0 && end > start, 'deleteClient function must exist');
const deleteSource = html.slice(start, end);

function makeDelete(state, confirmResult, onSave = () => {}) {
  return new Function(
    's', 'window', 'toast', 'persistMutationOrRollback',
    'let clientHistoryId = "client-1";\n' +
      'let nativeStateRevision = 10;\n' +
      deleteSource + '\nreturn deleteClient;'
  )(
    state,
    { confirm: () => confirmResult },
    () => {},
    async (previousState, previousRevision, message) => {
      onSave({ previousState, previousRevision, message });
      return true;
    }
  );
}

const state = {
  clients: [{ id: 'client-1', name: 'Исторический клиент', phone: '+7 900 000-00-00', kind: 'Частный клиент' }],
  docs: [
    { id: 'sale-1', type: 'sale', clientId: 'client-1', date: '2026-10-01', amount: 1200, paid: 500 },
    { id: 'service-1', type: 'service', clientId: 'client-1', date: '2026-10-02', amount: 800, qty: 4 },
    { id: 'receipt-1', type: 'receipt', supplier: 'Исторический клиент', date: '2026-10-03', amount: 400 }
  ],
  payments: [{ id: 'payment-1', clientId: 'client-1', amount: 500, date: '2026-10-04' }]
};
const docsBefore = JSON.stringify(state.docs);
const paymentsBefore = JSON.stringify(state.payments);
let saveInfo = null;

await makeDelete(state, true, info => { saveInfo = info; })('client-1');

assert.equal(state.clients.length, 1, 'Archived client record must remain for historical references');
assert.equal(state.clients[0].removedFromDirectory, true, 'Client must be marked as removed from the directory');
assert.equal(JSON.stringify(state.docs), docsBefore, 'Historical documents must not be modified or hidden');
assert.equal(JSON.stringify(state.payments), paymentsBefore, 'Historical payments must remain unchanged');
assert.ok(saveInfo, 'Removal must be persisted');
assert.match(saveInfo.message, /история и отчёты сохранены/i);

const cancelledState = {
  clients: [{ id: 'client-1', name: 'Не удалять' }],
  docs: [{ id: 'doc-1', clientId: 'client-1', amount: 100 }],
  payments: [{ id: 'pay-1', clientId: 'client-1', amount: 100 }]
};
const cancelledBefore = JSON.stringify(cancelledState);
let cancelledSave = false;
await makeDelete(cancelledState, false, () => { cancelledSave = true; })('client-1');
assert.equal(JSON.stringify(cancelledState), cancelledBefore, 'Cancelling confirmation must leave data untouched');
assert.equal(cancelledSave, false, 'Cancellation must not persist a mutation');

const systemState = {
  clients: [{ id: 'c_retail', name: 'Розничный покупатель (продажа из цеха)' }],
  docs: [],
  payments: []
};
await makeDelete(systemState, true)('c_retail');
assert.equal(systemState.clients[0].removedFromDirectory, undefined, 'System retail profile must not be deletable');

console.log('Client directory regression checks passed.');
