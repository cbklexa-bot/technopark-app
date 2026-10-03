# Технопарк PRO — настройка администратора

После включения RLS админка использует Supabase Auth.

## 1. Создать пользователя

В Supabase Dashboard откройте **Authentication → Users → Add user**.

Создайте отдельный email/password аккаунт администратора и включите подтверждение email автоматически (Auto Confirm).

## 2. Выдать роль admin

Откройте **SQL Editor** и выполните:

```sql
UPDATE auth.users
SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin'),
    updated_at = now()
WHERE email = 'EMAIL_АДМИНИСТРАТОРА';
```

Важно: роль должна находиться именно в `raw_app_meta_data`, а не в `raw_user_meta_data`.

## 3. Вход

В приложении нажмите **Админ** и войдите созданным email/password.

Без роли `admin` таблицы `tp_stock`, `tp_sessions`, `tp_sales` и `tp_expenses` не доступны.

## Защита базы

Для этих таблиц включён RLS.
Доступ предоставлен только роли `authenticated`, а policies разрешают операции только пользователю с JWT claim:

```
app_metadata.role = admin
```
