import './cloud-config.js';
import { isObfuscatedSignupResponse, classifyAuthError } from './auth-logic.js';
import { createClient } from '@supabase/supabase-js';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import * as XLSX from 'xlsx';
import { CANONICAL_CLIENTS, clean, norm, num, stableId, arrayRows, headerValue, dateISO, amountForState, costForState, rowDocType, findSheet, parseWorkbook } from './excel-import.js';

const runtimeConfig = window.KoptilnyaCloudConfig || {};
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || runtimeConfig.url || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = String(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.publishableKey || '',
).trim();
const configured = /^https:\/\/[^/]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_KEY.length > 20;
// Native callback must also be added to Supabase Auth > URL Configuration > Additional Redirect URLs.
const AUTH_REDIRECT_URL = 'ru.koptilnya.app://auth/callback';

const EMPTY_STATE = () => ({
  products: [], clients: [], docs: [], expenses: [], batches: [], recipes: [], payments: [], importHistory: [],
});
const css = `
#koptilnyaAuthGate,#koptilnyaImportGate,#koptilnyaAccountGate{position:fixed;inset:0;z-index:100000;background:rgba(12,18,16,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#17201c}
.koptilnyaPanel{width:min(570px,100%);max-height:min(90vh,900px);overflow:auto;background:#fff;border-radius:20px;padding:24px;box-shadow:0 18px 70px #0006}
.koptilnyaPanel h2{margin:0 0 7px;font-size:24px;color:#17201c}.koptilnyaPanel p{margin:7px 0 14px;color:#536159}
.koptilnyaField{display:block;margin:12px 0 5px;font-weight:650;font-size:13px;color:#38453e}.koptilnyaPanel input[type=email],.koptilnyaPanel input[type=password],.koptilnyaPanel input[type=text],.koptilnyaPanel input[type=file]{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd3ce;border-radius:10px;padding:12px;font:inherit;background:#fff;color:#17201c}
.koptilnyaActions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.koptilnyaAuthLinks{display:flex;gap:14px;flex-wrap:wrap;margin-top:13px}.koptilnyaLink{border:0;background:transparent;padding:2px 0;color:#1c6046;font:600 13px system-ui,sans-serif;text-decoration:underline;cursor:pointer}.koptilnyaButton{border:0;border-radius:10px;background:#1c6046;color:white;font-weight:700;padding:12px 15px;font:inherit;cursor:pointer}.koptilnyaButton.secondary{background:#eef2ef;color:#22362b}.koptilnyaButton:disabled{opacity:.45;cursor:wait}
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
let passwordRecoveryMode = false;
let recoveryUiOpen = false;
let pendingOrganizationName = 'Коптильня';
const AUTH_REQUEST_TIMEOUT_MS = 20000;

// Supabase requests must settle so an auth button never remains disabled forever.
const fetchWithTimeout = async (input, init = {}) => {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const relayAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) relayAbort();
  else sourceSignal?.addEventListener?.('abort', relayAbort, { once: true });
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException('Supabase request timed out', 'TimeoutError')),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    sourceSignal?.removeEventListener?.('abort', relayAbort);
  }
};

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
const friendlyAuthError = (error, action = 'auth') => {
  const raw = String(error?.message || error?.error_description || error || '').trim();
  const code = String(error?.code || error?.error_code || '').toLowerCase();
  const combined = (raw + ' ' + code).toLowerCase();
  const kind = classifyAuthError(error);
  if (kind === 'timeout') {
    return 'Сервер не ответил за 20 секунд. Кнопка снова доступна. Проверьте интернет и повторите действие один раз; повторная регистрация может быть не нужна.';
  }
  if (kind === 'network') {
    return action === 'signup'
      ? 'Приложение не получило ответ от сервера. Регистрация могла дойти до Supabase, поэтому не создавайте аккаунт повторно несколько раз. Перейдите во «Войти» и попробуйте те же данные.'
      : 'Приложение не получило ответ от сервера. Проверьте интернет и повторите действие. Если аккаунт уже создавался, не регистрируйтесь заново.';
  }
  if (kind === 'email_rate_limited') {
    return 'Supabase временно ограничил отправку писем после нескольких запросов. Повторные нажатия не помогут. Дождитесь сброса лимита; для стабильной доставки писем настройте собственный SMTP в Supabase → Authentication → SMTP Settings.';
  }
  if (/users_email_partial_key|duplicate key|already registered|already been registered|user already exists|email_exists|user_already_exists/.test(combined)) {
    return 'Аккаунт с этой почтой уже существует. Повторная регистрация не нужна: войдите с прежним паролем или воспользуйтесь восстановлением пароля.';
  }
  if (kind === 'invalid_credentials') {
    return 'Почта или пароль не совпадают. Проверьте раскладку и пробелы; если пароль забыли, нажмите «Забыли пароль?».';
  }
  if (kind === 'email_unconfirmed') {
    return 'Аккаунт существует, но почта ещё не подтверждена. Проверьте последнее письмо или запросите повторное подтверждение, когда лимит отправки писем будет доступен.';
  }
  if (/database error saving new user|unexpected_failure/.test(combined)) {
    return 'Supabase не смог завершить регистрацию. Не повторяйте регистрацию много раз подряд. Попробуйте войти с теми же данными или восстановить пароль.';
  }
  return raw || (action === 'signup' ? 'Не удалось завершить регистрацию.' : 'Не удалось выполнить вход.');
};

const renderAuth = (mode = 'signin', message = '', messageKind = 'error') => {
  const previousEmail = clean(document.getElementById('koptilnyaEmail')?.value || '');
  const previousOrgName = clean(document.getElementById('koptilnyaOrgName')?.value || pendingOrganizationName || 'Коптильня') || 'Коптильня';
  const signingUp = mode === 'signup';
  const lowerMessage = String(message || '').toLowerCase();
  const showResend = !signingUp && /подтвержд|email not confirmed|confirm email/.test(lowerMessage)
    && !/лимит|слишком часто|дождитесь сброса/.test(lowerMessage);
  const showRetry = !signingUp && /рабочую область|повторить подключение|сессия сохранена/.test(lowerMessage);
  const gate = createOverlay(
    'koptilnyaAuthGate',
    'Коптильня',
    signingUp ? 'Создайте аккаунт для своей коптильни.' : 'Войдите, чтобы открыть свою коптильню и синхронизировать данные.'
  );
  const body = gate.querySelector('#koptilnyaAuthGateBody');
  body.innerHTML = `
    <form id="koptilnyaAuthForm">
      <label class="koptilnyaField" for="koptilnyaEmail">Электронная почта</label>
      <input id="koptilnyaEmail" type="email" name="email" autocomplete="email" required maxlength="254" value="${safeText(previousEmail)}" />
      <label class="koptilnyaField" for="koptilnyaPassword">Пароль</label>
      <input id="koptilnyaPassword" type="password" name="password" autocomplete="${signingUp ? 'new-password' : 'current-password'}" minlength="8" required />
      ${signingUp ? '<label class="koptilnyaField" for="koptilnyaOrgName">Название коптильни</label><input id="koptilnyaOrgName" type="text" name="orgName" maxlength="120" value="' + safeText(previousOrgName) + '" required />' : ''}
      <div class="koptilnyaActions"><button class="koptilnyaButton" id="koptilnyaAuthSubmit" type="submit">${signingUp ? 'Создать аккаунт' : 'Войти'}</button></div>
      <div class="koptilnyaAuthLinks">
        <button class="koptilnyaLink" type="button" id="koptilnyaAuthSwitch">${signingUp ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}</button>
        ${!signingUp ? '<button class="koptilnyaLink" type="button" id="koptilnyaReset">Забыли пароль?</button>' : ''}
        ${showResend ? '<button class="koptilnyaLink" type="button" id="koptilnyaResend">Не пришло письмо подтверждения?</button>' : ''}
        ${showRetry ? '<button class="koptilnyaLink" type="button" id="koptilnyaRetry">Повторить подключение</button>' : ''}
      </div>
    </form>`;
  body.querySelector('#koptilnyaAuthSwitch').addEventListener('click', () => renderAuth(signingUp ? 'signin' : 'signup'));
  const form = body.querySelector('#koptilnyaAuthForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = body.querySelector('#koptilnyaAuthSubmit');
    if (submit.disabled) return;
    submit.disabled = true;
    const originalSubmitLabel = submit.textContent;
    submit.textContent = signingUp ? 'Создаём аккаунт…' : 'Выполняем вход…';
    setOverlayStatus('koptilnyaAuthGate', signingUp
      ? 'Отправляем запрос регистрации. Если сервер не ответит за 20 секунд, форма покажет ошибку и снова станет доступна.'
      : 'Проверяем данные и подключаем рабочую область…');
    const data = new FormData(form);
    const email = clean(data.get('email')).toLowerCase();
    const password = String(data.get('password') || '');
    const desiredOrgName = clean(data.get('orgName')) || previousOrgName || 'Коптильня';
    if (signingUp) pendingOrganizationName = desiredOrgName;
    try {
      if (signingUp) {
        const {data: result, error} = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: email.split('@')[0], organization_name: desiredOrgName }, emailRedirectTo: AUTH_REDIRECT_URL }
        });
        if (error) throw error;
        if (!result.session) {
          const mayBeExistingAccount = isObfuscatedSignupResponse(result.user)
            || !!(result.user?.email_confirmed_at || result.user?.confirmed_at);
          if (mayBeExistingAccount) {
            setOverlayStatus('koptilnyaAuthGate', 'Проверяю вход в ранее созданный аккаунт…');
            const {data: loginResult, error: loginError} = await supabase.auth.signInWithPassword({email, password});
            if (!loginError && loginResult?.session) return;
            const loginErrorKind = classifyAuthError(loginError);
            if (loginError && (loginErrorKind === 'network' || loginErrorKind === 'timeout')) throw loginError;
            if (loginErrorKind === 'email_unconfirmed') {
              renderAuth('signin', 'Аккаунт существует, но почта ещё не подтверждена. Проверьте последнее письмо. Если письма нет, повторная отправка может быть временно ограничена.', 'error');
            } else {
              renderAuth('signin', 'Этот адрес уже мог использоваться для регистрации. Войдите с прежним паролем. Если пароль не подходит, нажмите «Забыли пароль?». Повторная регистрация не создаст второй аккаунт.', 'error');
            }
            return;
          }
          renderAuth('signin', 'Регистрация принята. Откройте почту и подтвердите адрес по последнему письму Supabase, если подтверждение требуется. Если письма нет во «Входящих» и «Спаме», отправка могла быть ограничена сервером. Не нажимайте регистрацию повторно.', 'ok');
          return;
        }
        // The auth-state listener opens the new session and creates the workspace.
      } else {
        const {error} = await supabase.auth.signInWithPassword({email, password});
        if (error) throw error;
        // The auth-state listener opens the signed-in session and creates the workspace.
      }
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', friendlyAuthError(error, signingUp ? 'signup' : 'signin'), 'error');
    } finally {
      if (submit.isConnected) {
        submit.disabled = false;
        submit.textContent = originalSubmitLabel;
      }
    }
  });
  const reset = body.querySelector('#koptilnyaReset');
  if (reset) reset.addEventListener('click', async () => {
    const email = clean(body.querySelector('#koptilnyaEmail').value).toLowerCase();
    if (!email) { setOverlayStatus('koptilnyaAuthGate', 'Введите электронную почту для восстановления пароля.', 'error'); return; }
    reset.disabled = true;
    try {
      const {error} = await supabase.auth.resetPasswordForEmail(email, { redirectTo: AUTH_REDIRECT_URL });
      if (error) throw error;
      setOverlayStatus('koptilnyaAuthGate', 'Supabase принял запрос восстановления. Проверьте «Входящие» и «Спам». Доставка не гарантируется при ограничении лимита; для стабильной работы нужен собственный SMTP.', 'ok');
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', friendlyAuthError(error, 'recovery'), 'error');
    } finally { reset.disabled = false; }
  });
  const retry = body.querySelector('#koptilnyaRetry');
  if (retry) retry.addEventListener('click', async () => {
    retry.disabled = true;
    setOverlayStatus('koptilnyaAuthGate', 'Повторно подключаю рабочую область по сохранённой сессии…');
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        setOverlayStatus('koptilnyaAuthGate', 'Сохранённая сессия не найдена. Войдите с почтой и паролем.', 'error');
        return;
      }
      await openWorkspace(data.session, clean(data.session.user?.user_metadata?.organization_name) || pendingOrganizationName);
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', friendlyAuthError(error, 'workspace'), 'error');
    } finally {
      if (retry.isConnected) retry.disabled = false;
    }
  });
  const resend = body.querySelector('#koptilnyaResend');
  if (resend) resend.addEventListener('click', async () => {
    const email = clean(body.querySelector('#koptilnyaEmail').value).toLowerCase();
    if (!email) { setOverlayStatus('koptilnyaAuthGate', 'Введите электронную почту, чтобы отправить письмо подтверждения.', 'error'); return; }
    resend.disabled = true;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup', email,
        options: { emailRedirectTo: AUTH_REDIRECT_URL },
      });
      if (error) throw error;
      setOverlayStatus('koptilnyaAuthGate', 'Supabase принял запрос на подтверждение. Проверьте входящие и папку «Спам». При исчерпанном лимите или без SMTP письмо может не прийти.', 'ok');
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', friendlyAuthError(error, 'recovery'), 'error');
    } finally { resend.disabled = false; }
  });
  if (message) setOverlayStatus('koptilnyaAuthGate', message, messageKind);
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
    .from('kp_organization_members')
    .select('organization_id, role, status, kp_organizations(name, timezone)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1);
  if (error) throw error;
  if (!memberships?.length) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const {data: newOrgId, error: createError} = await supabase.rpc('kp_create_organization', {
      p_name: desiredName || 'Коптильня',
      p_timezone: timeZone,
    });
    if (createError) throw createError;
    organizationId = newOrgId;
    const loaded = await supabase.from('kp_organizations').select('name').eq('id', organizationId).single();
    if (loaded.error) throw loaded.error;
    organizationName = loaded.data.name;
  } else {
    const membership = memberships[0];
    organizationId = membership.organization_id;
    organizationName = membership.kp_organizations?.name || 'Коптильня';
  }
  return {organizationId, organizationName};
};
const hasBusinessRows = (state) => !!state && ['products','clients','docs','expenses','batches','payments'].some((key) => Array.isArray(state[key]) && state[key].length);
const renderInitialChoice = (remoteRevision, remoteState, localState, remoteExists = false) => new Promise((resolve) => {
  const localHasData = hasBusinessRows(localState);
  const cloudState = remoteState || EMPTY_STATE();
  const remoteHasData = hasBusinessRows(cloudState);
  const demoProductNames = new Set(['Грудинка горячего копчения','Колбаса копчёная','Купаты','Шашлык свиной','Копчение сырья клиента','Изготовление колбас из сырья клиента'].map(norm));
  const hasLegacyDemoData = !!localState && (
    (localState.products || []).some((p) => demoProductNames.has(norm(p.name))) ||
    (localState.clients || []).some((c) => ['Магазин «У дома»','Продукты № 2','Мясной ряд','Заказчик услуг'].some((name) => norm(name) === norm(c.name))) ||
    (localState.docs || []).some((d) => ['НК-0108','НК-0109','УС-0032'].includes(clean(d.number)))
  );
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
  const localPreview = [
    ...(Array.isArray(localState?.products) ? localState.products.slice(0,4).map((x) => 'Товар: ' + (x.name || 'без названия')) : []),
    ...(Array.isArray(localState?.clients) ? localState.clients.slice(0,4).map((x) => 'Клиент: ' + (x.name || 'без названия')) : []),
    ...(Array.isArray(localState?.docs) ? localState.docs.slice(0,4).map((x) => 'Документ: ' + (x.number || x.date || 'без номера')) : []),
  ].join('\n');
  const sampleWarning = hasLegacyDemoData
    ? '<div class="koptilnyaStatus error"><b>Внимание:</b> похоже, здесь остались демонстрационные товары/документы из старой тестовой версии. Не переноси их в рабочую базу, если это не реальные записи. Для загрузки своего Excel лучше сначала начать с пустой облачной базы.</div>'
    : '';
  body.innerHTML = sampleWarning + (existingCloud
    ? '<div class="koptilnyaStatus"><b>На телефоне</b>\n' + safeText(localCounts) + '\n' + safeText(localPreview) + '\n\n<b>В облаке</b>\n' + safeText(cloudCounts) + '</div>' +
      '<div class="koptilnyaActions"><button type="button" class="koptilnyaButton secondary" id="koptilnyaUseCloud">Использовать облако</button><button type="button" class="koptilnyaButton" id="koptilnyaUseLocal">Заменить облако данными телефона</button></div>'
    : '<div class="koptilnyaStatus">' + safeText(localCounts) + '\n' + safeText(localPreview) + '</div>' +
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
      .from('kp_organization_data')
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
      const {data, error: persistError} = await supabase.rpc('kp_save_organization_data', {
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
    renderAuth('signin', 'Вход в аккаунт сохранён, но рабочую область открыть не удалось. ' + friendlyAuthError(error, 'workspace') + (String(error?.message || '').toLowerCase().includes('failed to fetch') ? '' : '\nПодробности: ' + (error?.message || 'ошибка сервера')), 'error');
  }
};

const flushSave = async () => {
  if (!cloudActive || !organizationId || syncBlocked || !pendingState) return;
  const latest = pendingState;
  pendingState = null;
  setCloudStatus('Сохраняю…');
  const {data, error} = await supabase.rpc('kp_save_organization_data', {
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
      const {data, error} = await supabase.rpc('kp_save_organization_data', {
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
  const {data, error} = await supabase.from('kp_organization_data').select('state,revision').eq('organization_id',organizationId).maybeSingle();
  if (error) { toast(error.message || 'Не удалось перечитать данные', true); return; }
  revision = Number(data?.revision) || 0;
  syncBlocked = false;
  pendingState = null;
  cloudActive = false;
  app()?.setState(data?.state || EMPTY_STATE());
  cloudActive = true;
  setCloudStatus('Обновлено', 'ok');
};

const showPasswordRecovery = (currentSession) => {
  if (recoveryUiOpen) return;
  recoveryUiOpen = true;
  const gate = createOverlay('koptilnyaAuthGate', 'Новый пароль', 'Установите новый пароль для своего аккаунта.');
  const body = gate.querySelector('#koptilnyaAuthGateBody');
  body.innerHTML = '<form id="koptilnyaNewPassword"><label class="koptilnyaField" for="koptilnyaNewPasswordValue">Новый пароль</label><input id="koptilnyaNewPasswordValue" type="password" name="password" minlength="8" autocomplete="new-password" required /><div class="koptilnyaActions"><button class="koptilnyaButton" type="submit">Сохранить пароль</button></div></form>';
  const form = body.querySelector('form');
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = String(new FormData(form).get('password') || '');
    submit.disabled = true;
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      passwordRecoveryMode = false;
      recoveryUiOpen = false;
      gate.remove();
      const current = await supabase.auth.getSession();
      await openWorkspace(current.data.session || currentSession);
    } catch (error) {
      setOverlayStatus('koptilnyaAuthGate', error?.message || 'Не удалось сохранить новый пароль.', 'error');
    } finally {
      if (gate.isConnected) submit.disabled = false;
    }
  });
};

const handleAuthRedirect = async (rawUrl) => {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { return false; }
  if (url.protocol !== 'ru.koptilnya.app:' || url.hostname !== 'auth' || url.pathname !== '/callback') return false;
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const value = (key) => hash.get(key) || query.get(key);
  const errorCode = value('error_code') || value('error');
  const errorDescription = value('error_description') || '';
  if (errorCode) {
    renderAuth('signin');
    const message = errorCode === 'otp_expired'
      ? 'Ссылка подтверждения истекла или уже была открыта почтовым сканером. Нажмите «Отправить письмо подтверждения повторно» и используйте самое новое письмо.'
      : 'Не удалось подтвердить ссылку (' + String(errorDescription || errorCode).replace(/[+_]/g, ' ') + '). Запросите новое письмо и повторите попытку.';
    setOverlayStatus('koptilnyaAuthGate', message, 'error');
    return true;
  }
  const type = value('type') || '';
  if (type === 'recovery') passwordRecoveryMode = true;
  try {
    const code = query.get('code') || hash.get('code');
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      if (type === 'recovery') showPasswordRecovery(data.session);
      return true;
    }
    const access_token = value('access_token');
    const refresh_token = value('refresh_token');
    if (!access_token || !refresh_token) {
      renderAuth('signin');
      setOverlayStatus('koptilnyaAuthGate', 'Ссылка открылась, но не содержит данных подтверждения. Запросите новое письмо и откройте именно последнее сообщение от Supabase.', 'error');
      return true;
    }
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    if (type === 'recovery') showPasswordRecovery(data.session);
    return true;
  } catch (error) {
    passwordRecoveryMode = false;
    renderAuth('signin');
    setOverlayStatus('koptilnyaAuthGate', error?.message || 'Не удалось завершить подтверждение. Запросите новую ссылку.', 'error');
    return true;
  }
};

const init = async () => {
  if (!configured) { renderConfigBlocker(); return; }
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: fetchWithTimeout },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.KoptilnyaCloud = { queueSave, reload: reloadRemoteState };
  window.addEventListener('koptilnya-state-change', (event) => queueSave(event.detail));
  if (Capacitor.isNativePlatform()) {
    await App.addListener('appUrlOpen', ({ url }) => { void handleAuthRedirect(url); });
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleAuthRedirect(launch.url);
  }
  supabase.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_OUT') {
      cloudActive = false; session = null; user = null; organizationId = null; organizationName = '';
      document.getElementById('koptilnyaCloudBar')?.remove();
      if (supabase) renderAuth('signin');
    } else if (event === 'SIGNED_IN' && nextSession && nextSession.user?.id !== user?.id) {
      if (passwordRecoveryMode) { showPasswordRecovery(nextSession); return; }
      queueMicrotask(() => openWorkspace(nextSession, clean(nextSession.user?.user_metadata?.organization_name) || pendingOrganizationName));
    } else if (event === 'PASSWORD_RECOVERY' && nextSession) {
      passwordRecoveryMode = true;
      showPasswordRecovery(nextSession);
    }
  });
  const {data, error} = await supabase.auth.getSession();
  if (error) { renderAuth('signin', error.message); return; }
  if (data.session) {
    session = data.session;
    await openWorkspace(data.session, clean(data.session.user?.user_metadata?.organization_name) || pendingOrganizationName);
  } else {
    renderAuth('signin');
  }
};
void init();
