# Деплой coin-save-api

Як бекенд потрапляє на VPS, де лежать налаштування і що робити, коли щось
пішло не так.

## Як це працює

Workflow `.github/workflows/ci-cd.yml` працює так: тести один раз на PR,
а після мержу в `main` образ і деплой.

1. **check** (лише на PR у `main`): lint, prettier, typecheck, unit-тести,
   інтеграційні тести (Postgres піднімається в CI через testcontainers),
   `npm run build`. Новий пуш у PR скасовує попередню перевірку.
   Мерж можливий лише із зеленим `check` (див. «Захист гілки main»).
2. **docker** (після мержу в `main`): збирає образ і пушить у GHCR як
   `ghcr.io/stanislav-kozak/coin-save-api:main` і `:<sha коміту>`.
3. **deploy**:
   - збирає `.env` з налаштувань GitHub (див. нижче);
   - заходить на VPS по SSH і робить `git pull`;
   - кладе туди новий `.env`, а попередній зберігає як `.env.bak`;
   - запускає `./deploy.sh <sha>`.

   `deploy.sh` завантажує образ, перезапускає контейнери і до 60 секунд
   чекає, поки `/api/health` відповість 200. Якщо не дочекався, виводить
   логи, і деплой стає червоним.

Міграції БД (`prisma migrate deploy`) запускаються автоматично при старті
контейнера (`docker-entrypoint.sh`).

## Налаштування (.env) — тільки через GitHub

**`.env` на VPS вручну не редагуємо**: кожен деплой перезаписує його.
Усі значення живуть у GitHub → **Settings → Environments → `production`**:

- **Secrets**: паролі, ключі, рядки підключення. Після збереження значення
  не видно, його можна лише перезаписати. Тримайте копію в менеджері паролів.
- **Variables**: звичайні налаштування, їх видно й можна редагувати.

Деплой шукає кожне значення спершу серед Variables, потім серед Secrets,
тож помилка «не туди поклав» не страшна. Але облікові дані (паролі, ключі,
`DATABASE_URL`) тримайте в Secrets: значення Variables видно всім, хто має
доступ до налаштувань репозиторію. Значення з оточення `production` мають
пріоритет над однойменними на рівні репозиторію (Settings → Secrets and
variables → Actions); рекомендуємо тримати все в `production`.

| Тип | Назва | Обов'язково | Що це / приклад |
|---|---|---|---|
| Secret | `DATABASE_URL` | так | Рядок підключення Neon: `postgresql://user:pass@host/db?sslmode=require` |
| Secret | `JWT_ACCESS_SECRET` | так | Довгий випадковий рядок: `openssl rand -hex 32` |
| Secret | `JWT_REFRESH_SECRET` | так | Інший довгий випадковий рядок: `openssl rand -hex 32` |
| Secret | `GOOGLE_CLIENT_SECRET` | так | Google Cloud Console → Credentials → OAuth client |
| Secret | `RESEND_API_KEY` | так | Resend → API Keys, починається з `re_` |
| Secret | `SENTRY_DSN_BACKEND` | ні | DSN проєкту в Sentry |
| Variable | `GOOGLE_CLIENT_ID` | так | Google Cloud Console → Credentials → OAuth client |
| Variable | `FRONTEND_URL` | так | Адреса застосунку: `https://app.coinsavekeeper.com`. З неї будуються посилання в листах |
| Variable | `MAIL_FROM` | ні | `CoinSave <noreply@coinsavekeeper.com>`. Домен має бути підтверджений у Resend. Без цієї змінної пошта йде з `onboarding@resend.dev` і доходить лише власнику акаунта Resend |
| Variable | `CORS_ORIGIN` | ні | `https://app.coinsavekeeper.com` |
| Variable | `NODE_ENV` | ні | В образі вже стоїть `production`, задавати не треба |

Якщо бракує обов'язкового значення, деплой зупиняється **до** будь-яких
змін на VPS. Помилка в Actions назве лише змінні, яких бракує (значення
ніколи не виводяться).

Обмеження: значення не можуть містити одинарну лапку `'` і переносів рядка.

### Як додати або змінити налаштування

1. GitHub → Settings → Environments → `production` → змініть Secret або Variable.
2. Застосуйте: GitHub → **Actions → CI/CD → Run workflow** → гілка `main`
   → **Run workflow**. Поточна версія передеплоїться з новими налаштуваннями,
   новий коміт не потрібен.

### Як додати нову змінну в код

1. Додайте ключ у `.env.example` з коментарем.
2. Пропишіть його в `.github/workflows/ci-cd.yml`, у кроці
   «Render .env from GitHub settings»:
   `NAME: ${{ secrets.NAME }}` або `NAME: ${{ vars.NAME }}`.
3. Якщо змінна обов'язкова, додайте її в `REQUIRED` у `scripts/ci/render-env.sh`.
4. Задайте значення в GitHub (див. вище) **до** мержу.

Якщо забути крок 2, CI впаде на кроці «Deploy maps every .env.example key».

## Одноразове налаштування

### 1. SSH-ключ для деплою

Локально:

```bash
ssh-keygen -t ed25519 -f coinsave-deploy -N "" -C "github-actions-deploy"
```

- вміст `coinsave-deploy.pub` додати на VPS у `~/.ssh/authorized_keys`
  користувача, від імені якого йде деплой;
- вміст `coinsave-deploy` (приватний ключ) додати в GitHub як Secret
  `VPS_SSH_KEY` (див. далі). Після цього локальні файли ключа можна видалити.

### 2. Доступ до VPS у GitHub (Environment `production` → Secrets)

| Назва | Значення |
|---|---|
| `VPS_HOST` | IP або домен VPS, напр. `176.117.78.135` |
| `VPS_USER` | Користувач на VPS |
| `VPS_SSH_KEY` | Приватний ключ з кроку 1 |
| `VPS_APP_DIR` | Повний шлях до репозиторію на VPS, напр. `/home/<user>/coin-save-api` |
| `VPS_PORT` | Лише якщо SSH не на 22-му порту |

За бажанням: Environment `production` → **Required reviewers**. Тоді кожен
деплой чекатиме вашого підтвердження.

### 3. Захист гілки main (обов'язково)

Після мержу тести вдруге не запускаються, тож у `main` має потрапляти
лише перевірений код. GitHub → **Settings → Branches → Add branch ruleset**
(або **Add rule**) для `main`:

- **Require a pull request before merging**, тобто без прямих пушів у `main`;
- **Require status checks to pass** → додати `check`;
- **Require branches to be up to date before merging**: PR перевіряється
  разом з актуальним `main`, тож змерджиться рівно те, що пройшло тести.

### 4. VPS

- встановлені Docker з compose-плагіном і `git`;
- відкриті порти 80 і 443 (TCP, а 443 ще й UDP для HTTP/3);
- користувач у групі `docker`, тобто `docker ps` працює без `sudo`;
- репозиторій склонований у `VPS_APP_DIR`, на гілці `main`;
  `git pull` працює без пароля (deploy key або SSH-ключ на GitHub);
- образ у GHCR приватний: CI логіниться в реєстр сам на час деплою, на VPS
  нічого зберігати не треба.

## Домен і пошта (coinsavekeeper.com)

DNS у Cloudflare:

| Тип | Ім'я | Значення | Proxy |
|---|---|---|---|
| A | `app` | `176.117.78.135` | DNS only (сіра хмарка) |
| A | `dev` | `176.117.78.135` | DNS only (коли з'явиться dev-оточення) |

«DNS only» потрібне, щоб Caddy сам отримав сертифікат Let's Encrypt.
Якщо пізніше ввімкнути проксі Cloudflare (помаранчева хмарка), обов'язково
поставте **SSL/TLS → Full (strict)**. З режимом «Flexible» сайт піде в
нескінченний редирект.

HTTPS обслуговує Caddy (`Caddyfile`): `/api/*` і `/socket.io/*` йдуть на
бекенд, решта — на фронтенд (поки що там заглушка 503 «coming soon»).
Коли фронтенд житиме на цьому VPS як сервіс `web`, у `Caddyfile` треба
замінити блок-заглушку на `reverse_proxy web:3000`. Доступ по голому IP
перенаправляється на HTTPS і не працює, використовуйте домен.

Пошта, Resend:

1. Resend → **Domains → Add domain** → `coinsavekeeper.com`.
2. Записи, які покаже Resend (DKIM `resend._domainkey`, MX і SPF на `send`),
   додати в Cloudflare з **DNS only**.
3. Натиснути **Verify** і дочекатися статусу «Verified».
4. У GitHub задати Variable
   `MAIL_FROM` = `CoinSave <noreply@coinsavekeeper.com>` і запустити
   **Run workflow**.

Увага: усі auth-cookie мають прапорець `Secure`. Тому логін у браузері
працює лише через HTTPS на домені, а не через `http://<IP>`.

## Відкат і аварійні ситуації

**Повернути попередню версію коду.** На VPS:

```bash
cd <VPS_APP_DIR>
docker login ghcr.io -u <github-user>   # пароль: GitHub token з правом read:packages
./deploy.sh <sha-попереднього-коміту>   # sha видно в історії main або в Actions
docker logout ghcr.io
```

Або зробіть revert-коміт у `main`: він задеплоїться сам.

**Повернути попередній .env:**

```bash
cd <VPS_APP_DIR>
cp .env.bak .env && docker compose -f docker-compose.prod.yml up -d
```

Потім виправте значення в GitHub, інакше наступний деплой знову його перезапише.

**Деплой червоний.** Відкрийте Actions → запуск, що впав → крок, що впав:

- «Render .env…»: бракує налаштування в GitHub (назва буде в помилці);
- «ssh-action»: перевірте `VPS_*` secrets, SSH-ключ у `authorized_keys`
  і що на VPS працює `git pull`;
- «API did not become healthy»: нижче будуть логи контейнера. Часті причини:
  неправильний `DATABASE_URL` або обов'язкова змінна з порожнім чи
  неправильним значенням.

**Подивитися стан на VPS:**

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api   # 5xx-помилки логуються тут
docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://localhost:3000/api/health  # напряму в API
curl -s https://app.coinsavekeeper.com/api/health                                             # через Caddy і HTTPS
docker compose -f docker-compose.prod.yml logs --tail=50 caddy   # проблеми з сертифікатом видно тут
```
