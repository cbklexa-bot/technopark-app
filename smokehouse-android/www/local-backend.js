import * as XLSX from 'xlsx';
import { clean, parseWorkbook } from './excel-import.js';
import { PRODUCT_ID, PLAN_LABELS, verifyLicenseToken, evaluateTrial } from './license-core.js';

const TRIAL_DAYS = 7;
const LICENSE_TOKEN_KEY = 'koptilnya-license-token-v1';
const TRIAL_STATE_KEY = 'koptilnya-trial-state-v1';
const DEVICE_ID_KEY = 'koptilnya-device-id-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
let deviceId = '';
let trialState = { firstRunAt: 0, lastSeenAt: 0 };
let activeLicense = null;
let currentAccess = { allowed: false, trial: null, reason: '' };

const style = document.createElement('style');
style.textContent = [
  '#koptilnyaLocalBar{position:fixed;z-index:99999;top:10px;right:10px;display:flex;align-items:center;justify-content:flex-end;gap:7px;max-width:calc(100vw - 20px);flex-wrap:wrap;font:12px/1.3 system-ui,sans-serif}',
  '#koptilnyaLocalStatus{padding:8px 11px;border-radius:999px;background:#26392f;color:#fff;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.koptilnyaMini{border:0;border-radius:999px;background:#f5f7f5;color:#1b3a2b;padding:8px 11px;font:600 12px system-ui,sans-serif;box-shadow:0 2px 12px #0002;cursor:pointer}',
  '#koptilnyaLicenseGate,#koptilnyaImportGate{position:fixed;inset:0;z-index:100000;background:rgba(12,18,16,.90);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17201c}',
  '.koptilnyaPanel{width:min(570px,100%);max-height:min(90vh,900px);overflow:auto;background:#fff;border-radius:20px;padding:24px;box-shadow:0 18px 70px #0006}',
  '.koptilnyaPanel h2{margin:0 0 7px;font-size:24px;color:#17201c}.koptilnyaPanel p{margin:7px 0 14px;color:#536159}',
  '.koptilnyaField{display:block;margin:12px 0 5px;font-weight:650;font-size:13px;color:#38453e}.koptilnyaPanel input[type=text],.koptilnyaPanel input[type=file],.koptilnyaPanel textarea{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd3ce;border-radius:10px;padding:12px;font:inherit;background:#fff;color:#17201c}',
  '.koptilnyaActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.koptilnyaButton{border:0;border-radius:10px;background:#1c6046;color:white;font-weight:700;padding:12px 15px;font:inherit;cursor:pointer}.koptilnyaButton.secondary{background:#eef2ef;color:#22362b}.koptilnyaButton:disabled{opacity:.45;cursor:wait}',
  '.koptilnyaStatus{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f1f4f2;color:#35473b;white-space:pre-wrap}.koptilnyaStatus.error{background:#fff0ef;color:#912d26}.koptilnyaStatus.ok{background:#eaf7ef;color:#1d6541}',
  '.koptilnyaSheetGrid{display:grid;grid-template-columns:1fr auto;gap:7px 12px;font-size:13px}.koptilnyaSheetGrid>div{padding:7px 0;border-bottom:1px solid #edf0ee}',
  '.koptilnyaYearTable{border-collapse:collapse;width:100%;font-size:13px;margin-top:12px}.koptilnyaYearTable td,.koptilnyaYearTable th{padding:7px;border-bottom:1px solid #e4e9e6;text-align:right}.koptilnyaYearTable td:first-child,.koptilnyaYearTable th:first-child{text-align:left}',
  '@media(max-width:480px){.koptilnyaPanel{padding:18px;border-radius:16px}.koptilnyaPanel h2{font-size:21px}#koptilnyaLocalStatus{display:none}#koptilnyaLocalBar{top:6px;right:6px}}',
].join('\n');
document.head.appendChild(style);

const app = () => window.KoptilnyaApp;
const native = () => window.KoptilnyaNative;
const safeText = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatMoney = (value) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value) || 0);
const toast = (message, isError = false) => {
  let node = document.getElementById('koptilnyaLocalToast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'koptilnyaLocalToast';
    node.style.cssText = 'position:fixed;z-index:100005;left:12px;right:12px;bottom:16px;margin:auto;max-width:620px;padding:13px 16px;border-radius:12px;font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 5px 24px #0003;';
    document.body.appendChild(node);
  }
  node.style.background = isError ? '#fff0ef' : '#eaf7ef';
  node.style.color = isError ? '#912d26' : '#1d6541';
  node.textContent = message;
  node.hidden = false;
  if (node._hideTimer) clearTimeout(node._hideTimer);
  node._hideTimer = setTimeout(() => { node.hidden = true; }, 6500);
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
const setLocalStatus = (label) => {
  const node = document.getElementById('koptilnyaLocalStatus');
  if (node) node.textContent = label;
};
const getCurrentState = () => app()?.getState?.() || app()?.getLocalState?.() || {
  products: [], clients: [], docs: [], expenses: [], batches: [], recipes: [], payments: [], importHistory: [],
};
const saveTrialState = async () => {
  try { localStorage.setItem(TRIAL_STATE_KEY, JSON.stringify(trialState)); } catch {}
  try { await native()?.saveTrialState?.({ firstRunAt: trialState.firstRunAt, lastSeenAt: trialState.lastSeenAt }); } catch {}
};
const readLocalDeviceId = () => {
  let id = '';
  try { id = localStorage.getItem(DEVICE_ID_KEY) || ''; } catch {}
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = 'web-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch {}
  }
  return id;
};
const resolveDeviceId = async () => {
  try {
    const identity = await native()?.getLicenseIdentity?.();
    if (identity?.deviceId) return String(identity.deviceId);
  } catch (error) {
    console.warn('Native license identity unavailable; using this installation ID.', error);
  }
  return readLocalDeviceId();
};
const mergeTrialState = async () => {
  let local = { firstRunAt: 0, lastSeenAt: 0 };
  let nativeState = { firstRunAt: 0, lastSeenAt: 0 };
  try { local = JSON.parse(localStorage.getItem(TRIAL_STATE_KEY) || 'null') || local; } catch {}
  try { nativeState = await native()?.getTrialState?.() || nativeState; } catch {}
  const starts = [Number(local.firstRunAt) || 0, Number(nativeState.firstRunAt) || 0].filter((value) => value > 0);
  const seen = [Number(local.lastSeenAt) || 0, Number(nativeState.lastSeenAt) || 0].filter((value) => value > 0);
  const now = Date.now();
  trialState.firstRunAt = starts.length ? Math.min(...starts) : now;
  // Monotonic local time prevents a simple system-clock rollback from restarting the trial.
  trialState.lastSeenAt = Math.max(now, ...seen);
  await saveTrialState();
};
const getEffectiveNow = () => Math.max(Date.now(), Number(trialState.lastSeenAt) || 0);
const getStoredLicense = () => {
  try { return localStorage.getItem(LICENSE_TOKEN_KEY) || ''; } catch { return ''; }
};
const assessAccess = async () => {
  const now = getEffectiveNow();
  const storedToken = getStoredLicense();
  let licenseResult = { valid: false, reason: 'no_license' };
  if (storedToken) licenseResult = await verifyLicenseToken(storedToken, deviceId, now);
  if (licenseResult.valid) {
    activeLicense = licenseResult.payload;
    currentAccess = { allowed: true, trial: evaluateTrial(trialState.firstRunAt, now, TRIAL_DAYS), reason: 'licensed' };
    return currentAccess;
  }
  activeLicense = null;
  currentAccess.trial = evaluateTrial(trialState.firstRunAt, now, TRIAL_DAYS);
  currentAccess.allowed = currentAccess.trial.active;
  currentAccess.reason = licenseResult.reason === 'expired' ? 'license_expired' : currentAccess.trial.active ? 'trial' : 'trial_expired';
  return currentAccess;
};
const makeBar = () => {
  let bar = document.getElementById('koptilnyaLocalBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'koptilnyaLocalBar';
  bar.innerHTML = '<span id="koptilnyaLocalStatus">Локальная база</span><button type="button" class="koptilnyaMini" id="koptilnyaImportBtn">Импорт Excel</button><button type="button" class="koptilnyaMini" id="koptilnyaLicenseBtn">Лицензия</button>';
  document.body.appendChild(bar);
  bar.querySelector('#koptilnyaImportBtn').addEventListener('click', () => openImportPicker());
  bar.querySelector('#koptilnyaLicenseBtn').addEventListener('click', () => showLicenseGate(false));
  return bar;
};
const licenseStatusLabel = () => {
  if (activeLicense) {
    const expiry = new Date(activeLicense.exp).toLocaleDateString('ru-RU');
    return 'Лицензия до ' + expiry;
  }
  const trial = evaluateTrial(trialState.firstRunAt, getEffectiveNow(), TRIAL_DAYS);
  return trial.active ? 'Пробный период: ' + trial.remainingDays + ' дн.' : 'Требуется ключ активации';
};
const exportFullBackup = async () => {
  const backup = {
    format: 'koptilnya-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    application: 'Коптильня',
    contents: getCurrentState(),
  };
  if (native()?.exportFullArchive) {
    const filename = await native().exportFullArchive(backup);
    toast('Резервная копия сохранена: ' + filename);
    return filename;
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'koptilnya-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('Резервная копия подготовлена');
  return a.download;
};
const copyDeviceCode = async () => {
  try {
    await navigator.clipboard.writeText(deviceId);
    toast('Код устройства скопирован');
    return;
  } catch {}
  const input = document.getElementById('koptilnyaDeviceCode');
  if (input) {
    input.focus(); input.select();
    try { document.execCommand('copy'); toast('Код устройства скопирован'); } catch { toast('Выдели и скопируй код устройства вручную.'); }
  }
};
const reasonToText = (reason) => ({
  crypto_unavailable: 'На этом устройстве недоступна криптографическая проверка ключа. Обнови Android System WebView и повтори попытку.',
  bad_signature_format: 'Ключ повреждён. Проверь, что скопировал его целиком.',
  bad_signature: 'Подпись ключа не прошла проверку. Убедись, что ключ выдан именно для этого приложения.',
  wrong_product: 'Этот ключ предназначен для другой программы.',
  wrong_device: 'Ключ выдан для другого устройства. Пришли продавцу код устройства с этого экрана.',
  wrong_plan: 'В ключе указан неизвестный тариф.',
  bad_dates: 'В ключе некорректные даты.',
  bad_duration: 'Срок действия ключа не соответствует выбранному тарифу.',
  not_yet_valid: 'Срок действия ключа ещё не начался. Проверь дату устройства.',
  expired: 'Срок действия этого ключа закончился. Запроси новый.',
  malformed: 'Не удалось прочитать ключ. Проверь, что вставил его полностью.',
  no_license: 'Введи ключ активации.',
})[reason] || 'Ключ не подошёл. Проверь его и попробуй снова.';
const showLicenseGate = (blocking, initialMessage = '') => {
  const gate = createOverlay(
    'koptilnyaLicenseGate',
    blocking ? 'Активируй «Коптильню»' : 'Лицензия «Коптильня»',
    blocking
      ? 'Семидневный пробный период завершён. Данные остались на устройстве. Введи ключ или сначала сохрани резервную копию.'
      : 'Приложение работает автономно: без аккаунта и без подключения к серверу. Ключ привязывается к этому устройству.',
  );
  const body = gate.querySelector('#koptilnyaLicenseGateBody');
  const expires = activeLicense ? 'Лицензия действует до ' + new Date(activeLicense.exp).toLocaleString('ru-RU') + '.' :
    currentAccess.trial?.active ? 'Пробный период заканчивается ' + new Date(currentAccess.trial.expiresAt).toLocaleString('ru-RU') + '.' : 'Лицензия или пробный период не активны.';
  body.innerHTML =
    '<div class="koptilnyaStatus">' + safeText(expires) + '</div>' +
    '<label class="koptilnyaField" for="koptilnyaDeviceCode">Код этого устройства — отправь его продавцу для выпуска ключа</label>' +
    '<input id="koptilnyaDeviceCode" type="text" readonly value="' + safeText(deviceId) + '" />' +
    '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton secondary" id="koptilnyaCopyDevice">Скопировать код устройства</button></div>' +
    '<label class="koptilnyaField" for="koptilnyaActivationKey">Ключ активации</label>' +
    '<textarea id="koptilnyaActivationKey" rows="4" maxlength="2048" placeholder="Вставь ключ, полученный от продавца"></textarea>' +
    '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaActivate">Активировать</button>' +
    '<button type="button" class="koptilnyaButton secondary" id="koptilnyaBackup">Сохранить резервную копию</button>' +
    (!blocking ? '<button type="button" class="koptilnyaButton secondary" id="koptilnyaLicenseClose">Закрыть</button>' : '') + '</div>';
  body.querySelector('#koptilnyaCopyDevice').addEventListener('click', () => { void copyDeviceCode(); });
  body.querySelector('#koptilnyaBackup').addEventListener('click', async () => {
    const button = body.querySelector('#koptilnyaBackup');
    button.disabled = true;
    try { await exportFullBackup(); setOverlayStatus('koptilnyaLicenseGate', 'Резервная копия сохранена. Можно продолжить активацию.', 'ok'); }
    catch (error) { setOverlayStatus('koptilnyaLicenseGate', 'Не удалось сохранить резервную копию: ' + (error?.message || 'ошибка'), 'error'); }
    finally { button.disabled = false; }
  });
  body.querySelector('#koptilnyaActivate').addEventListener('click', async () => {
    const button = body.querySelector('#koptilnyaActivate');
    const token = String(body.querySelector('#koptilnyaActivationKey').value || '').replace(/\s+/g, '').trim();
    if (!token) { setOverlayStatus('koptilnyaLicenseGate', 'Вставь ключ активации.', 'error'); return; }
    button.disabled = true;
    setOverlayStatus('koptilnyaLicenseGate', 'Проверяю цифровую подпись ключа на устройстве…');
    try {
      const result = await verifyLicenseToken(token, deviceId, getEffectiveNow());
      if (!result.valid) {
        setOverlayStatus('koptilnyaLicenseGate', reasonToText(result.reason), 'error');
        return;
      }
      localStorage.setItem(LICENSE_TOKEN_KEY, token);
      activeLicense = result.payload;
      currentAccess = { allowed: true, trial: evaluateTrial(trialState.firstRunAt, getEffectiveNow(), TRIAL_DAYS), reason: 'licensed' };
      gate.remove();
      setLocalStatus(licenseStatusLabel());
      toast('Программа активирована до ' + new Date(activeLicense.exp).toLocaleDateString('ru-RU'));
    } catch (error) {
      setOverlayStatus('koptilnyaLicenseGate', 'Не удалось проверить ключ: ' + (error?.message || 'ошибка'), 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  if (!blocking) body.querySelector('#koptilnyaLicenseClose').addEventListener('click', () => gate.remove());
  if (initialMessage) setOverlayStatus('koptilnyaLicenseGate', initialMessage, 'error');
  return gate;
};

let lastFileImport = null;
const openImportPicker = () => {
  if (!currentAccess.allowed) { showLicenseGate(true, 'Для импорта нужна активная лицензия или действующий пробный период.'); return; }
  const gate = createOverlay('koptilnyaImportGate', 'Импорт из Excel', 'Файл читается только на этом устройстве. Перед заменой текущих данных приложение сохранит резервную копию.');
  const body = gate.querySelector('#koptilnyaImportGateBody');
  body.innerHTML =
    '<label class="koptilnyaField" for="koptilnyaExcelFile">Excel-файл (.xlsx, .xls)</label>' +
    '<input id="koptilnyaExcelFile" type="file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />' +
    '<div id="koptilnyaImportPreview"></div>' +
    '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton" id="koptilnyaImportConfirm" disabled>Импортировать и заменить данные</button><button type="button" class="koptilnyaButton secondary" id="koptilnyaImportCancel">Отмена</button></div>';
  let parsed = null;
  const preview = body.querySelector('#koptilnyaImportPreview');
  const confirm = body.querySelector('#koptilnyaImportConfirm');
  body.querySelector('#koptilnyaImportCancel').addEventListener('click', () => gate.remove());
  body.querySelector('#koptilnyaExcelFile').addEventListener('change', async (event) => {
    confirm.disabled = true; parsed = null;
    const file = event.target.files?.[0];
    preview.replaceChildren();
    if (!file) return;
    setOverlayStatus('koptilnyaImportGate', 'Читаю листы Excel на устройстве…');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      parsed = parseWorkbook(workbook, file.name);
      lastFileImport = parsed;
      const table = document.createElement('div');
      table.className = 'koptilnyaStatus';
      table.innerHTML = '<div class="koptilnyaSheetGrid">' + parsed.summary.sheets.map((sheet) =>
        '<div>' + safeText(sheet.name) + '<span style="float:right">' + sheet.rows + ' строк</span></div>').join('') + '</div>';
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
        [2025, 2026].map((year) => {
          const y = parsed.summary.years[year] || { revenue: 0, cost: 0, expenses: 0, payments: 0, productionKg: 0 };
          return '<tr><td>' + year + '</td><td>' + formatMoney(y.revenue) + '</td><td>' + formatMoney(y.cost) + '</td><td>' +
            formatMoney(y.expenses) + '</td><td>' + formatMoney(y.payments) + '</td><td>' +
            Number(y.productionKg || 0).toLocaleString('ru-RU') + '</td></tr>';
        }).join('') + '</tbody>';
      preview.appendChild(annual);
      if (parsed.summary.warnings.length) {
        const warnings = document.createElement('div');
        warnings.className = 'koptilnyaStatus ' + (parsed.summary.warnings.some((warning) =>
          /повтор|не удалось|нет отдельных|отсутствует распознаваемая дата/i.test(warning)) ? 'error' : '');
        warnings.textContent = 'Проверь перед импортом:\n• ' + parsed.summary.warnings.join('\n• ');
        preview.appendChild(warnings);
      }
      const hasSourceDocs = !!parsed.summary.sourceSheets.documents && counts.documents > 0;
      const hasProducts = !!parsed.summary.sourceSheets.products || !!parsed.summary.sourceSheets.stock;
      const hasClients = !!parsed.summary.sourceSheets.clients;
      const blockingWarnings = parsed.summary.warnings.some((warning) =>
        /повтор ключа документа|повторяются идентификаторы документов|не удалось определить тип документа|отсутствует распознаваемая дата|сумма позиций документа|себестоимость позиций документа|контрольная запись|контрольную запись|платёж с распределением|строка позиции №|позиция документа/i.test(warning));
      confirm.disabled = !hasSourceDocs || !hasProducts || !hasClients || counts.documents === 0 || blockingWarnings;
      setOverlayStatus('koptilnyaImportGate', confirm.disabled
        ? 'Импорт заблокирован: нужен отдельный лист исходных документов с датами и типами; исправь критические ошибки, показанные выше.'
        : 'Проверь количество строк и суммы. Следующее нажатие заменит локальные данные; ZIP-копия будет сохранена перед заменой.', confirm.disabled ? 'error' : 'ok');
    } catch (error) {
      parsed = null;
      setOverlayStatus('koptilnyaImportGate', 'Не удалось безопасно прочитать файл: ' + (error?.message || 'неизвестный формат'), 'error');
    }
  });
  confirm.addEventListener('click', async () => {
    if (!parsed || confirm.disabled) return;
    const accepted = window.confirm('Текущие данные на этом устройстве будут заменены данными из «' + parsed.filename + '». Перед заменой будет создана резервная копия. Продолжить?');
    if (!accepted) return;
    confirm.disabled = true;
    setOverlayStatus('koptilnyaImportGate', 'Сохраняю резервную копию и импортирую данные на устройство…');
    try {
      const previous = getCurrentState();
      await exportFullBackup();
      parsed.state.importHistory = [
        ...(Array.isArray(previous.importHistory) ? previous.importHistory : []),
        {
          fileName: parsed.filename,
          importedAt: new Date().toISOString(),
          sourceSheets: parsed.summary.sourceSheets,
          counts: parsed.summary.counts,
          yearlyTotals: parsed.summary.years,
          warnings: parsed.summary.warnings,
        },
      ];
      app()?.setState(parsed.state);
      gate.remove();
      setLocalStatus(licenseStatusLabel());
      toast('Импорт завершён и сохранён на устройстве. Проверь отчёты и список контрагентов.');
    } catch (error) {
      confirm.disabled = false;
      setOverlayStatus('koptilnyaImportGate', 'Импорт не завершён: ' + (error?.message || 'ошибка') + '. Исходные данные не заменены.', 'error');
    }
  });
};

const refreshAccessState = async () => {
  const wasAllowed = currentAccess.allowed;
  trialState.lastSeenAt = Math.max(Number(trialState.lastSeenAt) || 0, Date.now());
  await saveTrialState();
  currentAccess = await assessAccess();
  const bar = document.getElementById('koptilnyaLocalBar');
  if (bar) bar.style.display = currentAccess.allowed ? 'flex' : 'none';
  setLocalStatus(licenseStatusLabel());
  if (!currentAccess.allowed && (wasAllowed || !document.getElementById('koptilnyaLicenseGate'))) {
    const reason = currentAccess.reason === 'license_expired' ? 'Срок лицензии закончился.' : 'Семидневный пробный период завершён.';
    showLicenseGate(true, reason + ' Данные не удалены; до активации можно сохранить резервную копию.');
  }
};

const initLocalApp = async () => {
  deviceId = await resolveDeviceId();
  await mergeTrialState();
  currentAccess = await assessAccess();
  const bar = makeBar();
  bar.style.display = currentAccess.allowed ? 'flex' : 'none';
  setLocalStatus(licenseStatusLabel());
  window.addEventListener('koptilnya-state-change', () => {
    // The accounting interface itself saves every mutation to localStorage.
    setLocalStatus(licenseStatusLabel());
  });
  window.KoptilnyaLocal = Object.freeze({
    mode: 'offline',
    productId: PRODUCT_ID,
    getDeviceId: () => deviceId,
    getAccess: () => ({ ...currentAccess }),
    showLicense: () => showLicenseGate(false),
    exportBackup: exportFullBackup,
  });
  if (!currentAccess.allowed) {
    const reason = currentAccess.reason === 'license_expired' ? 'Срок лицензии закончился.' : 'Семидневный пробный период завершён.';
    showLicenseGate(true, reason + ' Данные не удалены; до активации можно сохранить резервную копию.');
  }
  window.addEventListener('focus', () => { void refreshAccessState(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshAccessState(); });
  setInterval(() => { if (!document.hidden) void refreshAccessState(); }, 60_000);
};
void initLocalApp().catch((error) => {
  console.error('Koptilnya local initialization failed', error);
  const root = createOverlay('koptilnyaLicenseGate', 'Коптильня', 'Не удалось запустить локальный режим.');
  root.querySelector('#koptilnyaLicenseGateBody').textContent = 'Перезапусти приложение. Данные не удалялись. ' + (error?.message || '');
});
