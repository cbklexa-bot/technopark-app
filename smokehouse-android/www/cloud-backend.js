import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { CANONICAL_CLIENTS, clean, norm, num, stableId, arrayRows, headerValue, dateISO, amountForState, costForState, rowDocType, findSheet, parseWorkbook } from './excel-import.js';

const runtimeConfig = window.KoptilnyaCloudConfig || {};
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || runtimeConfig.url || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.publishableKey || '',
).trim();
const configured = /^https:\/\/[^/]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;

const EMPTY_STATE = () => ({
  products: [], clients: [], docs: [], expenses: [], batches: [], recipes: [], payments: [], importHistory: [],
});
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
const hasBusinessRows = (state) => !!state && ['products','clients','docs','expenses','batches','payments'].some((key) => Array.isArray(state[key]) && state[key].length);
const renderInitialChoice = (remoteRevision, remoteState, localState, remoteExists = false) => new Promise((resolve) => {
  const localHasData = hasBusinessRows(localState);
  const cloudState = remoteState || EMPTY_STATE();
  const remoteHasData = hasBusinessRows(cloudState);
  if (!localHasData) { resolve({state: cloudState, revision: remoteRevision, source: 'cloud'}); return; }
  if (remoteExists && JSON.stringify(localState) === JSON.stringify(cloudState)) {
    resolve({state: cloudState, revision: remoteRevision, source: 'cloud'});
    return;
  }
  const existingCloud = remoteExists;
  const title = existingCloud ? 'Есть данные на телефоне и в облаке' : 'Данные на этом телефоне';
  const description = existingCloud
    ? 'Источники различаются. Сначала сравни их количество, затем явно выбери, какие данные оставить. Облако не будет перезаписано без подтверждения.'
    : 'На устройстве уже есть локальные записи, но в облачной коптильне пока нет базы. Выбери, что перенести. Ничего не будет отправлено без подтверждения.';
  const gate = createOverlay('koptilnyaInitialDataGate', title, description);
  const body = gate.querySelector('#koptilnyaInitialDataGateBody');
  const countsFor = (state) => ['products','clients','docs','expenses','batches','payments'].map((key) => key + ': ' + (Array.isArray(state?.[key]) ? state[key].length : 0)).join('\n');
  const localCounts = countsFor(localState);
  const cloudCounts = countsFor(cloudState);
  body.innerHTML = (existingCloud
    ? '<div class="koptilnyaStatus"><b>На телефоне</b>\n' + safeText(localCounts) + '\n\n<b>В облаке</b>\n' + safeText(cloudCounts) + '</div>' +
      '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton secondary" id="koptilnyaUseCloud">Использовать облако</button><button type="button" class="koptilnyaButton" id="koptilnyaUseLocal">Заменить облако данными телефона</button></div>'
    : '<div class="koptilnyaStatus">' + safeText(localCounts) + '</div>' +
      '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaUseLocal">Перенести эти данные в облако</button><button type="button" class="koptilnyaButton secondary" id="koptilnyaUseCloud">Начать с пустой базы</button></div>');
  body.querySelector('#koptilnyaUseCloud').addEventListener('click', () => {
    gate.remove();
    resolve({state: cloudState, revision: remoteRevision, source: 'cloud'});
  });
  body.querySelector('#koptilnyaUseLocal').addEventListener('click', async () => {
    const button = body.querySelector('#koptilnyaUseLocal');
    if (existingCloud && remoteHasData) {
      if (!window.confirm('Заменить текущие данные облачной коптильни данными этого телефона? Перед заменой будет создан ZIP-архив облачной базы.')) return;
      button.disabled = true;
      try {
        const nativeBridge = window.KoptilnyaNative;
        if (!nativeBridge?.exportFullArchive) throw new Error('Экспорт резервной копии недоступен; облачные данные не менялись.');
        await nativeBridge.exportFullArchive({format:'koptilnya-backup',version:2,exportedAt:new Date().toISOString(),application:'Коптильня',contents:cloudState});
      } catch (error) {
        button.disabled = false;
        setOverlayStatus('koptilnyaInitialDataGate', error?.message || 'Не удалось создать резервную копию облачных данных. Замена отменена.', 'error');
        return;
      }
    }
    gate.remove();
    resolve({state: localState, revision: remoteRevision, source: 'local', persistToCloud: remoteExists});
  });
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
    const remoteState = remote?.state || EMPTY_STATE();
    const remoteRevision = Number(remote?.revision) || 0;
    const local = app()?.getLocalState?.();
    const chosen = await renderInitialChoice(remoteRevision, remoteState, local, !!remote);
    revision = chosen.revision;
    app()?.setState(chosen.state);
    if (chosen.persistToCloud) {
      const {data, error: persistError} = await supabase.rpc('save_organization_data', {
        p_organization_id: organizationId,
        p_expected_revision: revision,
        p_state: chosen.state,
      });
      if (persistError) throw persistError;
      revision = Number(data) || revision + 1;
    }
    cloudActive = true;
    syncBlocked = false;
    if (gate) gate.remove();
    document.getElementById('koptilnyaInitialDataGate')?.remove();
    accountBar().style.display = 'flex';
    setCloudStatus(chosen.persistToCloud ? 'Данные телефона сохранены в облаке' : 'Облако подключено', 'ok');
    flushPromise = Promise.resolve();
    if (!remote) queueSave(app().getState());
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
      const hasProducts = !!parsed.summary.sourceSheets.products || !!parsed.summary.sourceSheets.stock;
      const hasClients = !!parsed.summary.sourceSheets.clients;
      const blockingWarnings = parsed.summary.warnings.some((w) => /повтор ключа документа|повторяются идентификаторы документов|не удалось определить тип документа|отсутствует распознаваемая дата|сумма позиций документа|себестоимость позиций документа|контрольная запись|контрольную запись|платёж с распределением|строка позиции №|позиция документа/i.test(w));
      confirm.disabled = !hasSourceDocs || !hasProducts || !hasClients || counts.documents === 0 || blockingWarnings;
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
