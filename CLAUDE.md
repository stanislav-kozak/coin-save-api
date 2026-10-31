# Проєкт coin-save-api

Бекенд для **CoinSave** — сімейного трекера витрат. Повна специфікація лежить
локально в `docs/specs/` (не в git — див. `.gitignore`).

## Стек
- Backend: NestJS (TypeScript), Node.js
- ORM: Prisma
- БД: Postgres 17 у Docker на VPS поруч з API (сервіс `db` у `docker-compose.prod.yml`,
  нічні бекапи `db-backup` → volume + опційно S3/R2). З Neon переїхали в PR #52;
  згадки Neon у `.env.example`/спеці — історичні
- Auth: Passport (`google`, `local`, `jwt`), `@nestjs/jwt`, `argon2` (хешування паролів і refresh-токенів)
- Realtime: Socket.IO (invalidation events по кімнатах простору)
- Cron: `@nestjs/schedule` (генерація recurring-транзакцій, нагадування, оновлення курсів валют)
- Email: Resend (SMTP) через `@nestjs-modules/mailer`, шаблони MJML + Handlebars
- Курси валют: `api.frankfurter.dev`, кеш у таблиці `ExchangeRate`
- Логи: поки що вбудований Nest `Logger` (`pino` заплановано специфікацією, ще не підключено)
- Error tracking: Sentry — заплановано (`SENTRY_DSN_BACKEND` є в env), SDK ще не підключено
- Rate limiting: `@nestjs/throttler`
- API-контракт: OpenAPI (`@nestjs/swagger`), фронтенд генерує типізований клієнт
- Менеджер пакетів: npm
- Тести: vitest (unit, `src/**/*.spec.ts`), vitest + `@testcontainers/postgresql` + supertest
  (integration, `test/integration/*.e2e-spec.ts`, потрібен запущений Docker). Playwright у цьому репо немає.
- Деплой: Docker + GitHub Container Registry, Caddy reverse proxy на VPS, GitHub Actions CI/CD
  (деталі — `DEPLOYMENT.md`). `README.md` — дефолтний шаблон Nest, не актуальний.

## Команди
- Встановити залежності: `npm install`
- Підняти локальну БД (Postgres у Docker): `npm run docker:up` / зупинити: `npm run docker:down`
- Запустити дев-сервер: `npm run start:dev` (потребує запущеної БД, див. вище)
- Запустити тести: `npm run test` (unit), `npm run test:e2e` (integration/Playwright)
- Лінтер: `npm run lint`
- Білд: `npm run build`
- Prisma міграції (dev): `npx prisma migrate dev`
- Prisma міграції (deploy): `npx prisma migrate deploy`
- Seed БД: `npx prisma db seed`

## Конвенції
- Стиль коду: ESLint + Prettier (стандартна конфігурація NestJS).
- Іменування файлів: kebab-case за конвенцією Nest — `*.controller.ts`, `*.service.ts`,
  `*.module.ts`, `*.guard.ts`, `*.dto.ts`; unit-тести — `*.spec.ts`.
- Структура — модуль на фічу: `auth/`, `users/`, `spaces/`, `wallets/`, `categories/`,
  `expenses/`, `transfers/`, `recurring/`, `analytics/`, `currencies/`, `notifications/`, `events/`,
  `common/`, `prisma/`, `mail/`.
- Грошові суми — виключно `Decimal(19, 4)`, ніколи `Float`.
- Помилки API повертаються як `{ statusCode, code, message, details }` —
  код, а не локалізований текст (локалізація на фронтенді).
- Guards композиційно: `JwtAuthGuard` → `SpaceMemberGuard` → `SpaceOwnerGuard`.

### Тестування
- Мок-хелпери для інтеграційних/unit-тестів беруться з `test/helpers/` (`createCookieAgent`,
  `buildPrismaMock`), а не копіюються в кожен новий `*.e2e-spec.ts`/`*.service.spec.ts` —
  дублювання цього коду вже тричі призводило до одного й того ж бага (див. нижче).
- При частковому override мок-об'єкта Prisma в тестах (`buildService({ prisma: {...} })`)
  злиття має бути **глибоким по таблиці**: `{ category: { ...defaults.category, ...overrides.category } }`,
  інакше не перевизначені методи (`delete`, `findMany` тощо) зникають і тест падає з
  `TypeError: ... is not a function`. Використовуй `buildPrismaMock` з `test/helpers/prisma-mock.ts`
  замість написання цього злиття вручну.

## Стан проєкту (на 2026-10-11, PR #1–#55 змерджені)
Усі модулі зі специфікації реалізовані й задеплоєні на `https://app.coinsavekeeper.com`
(бренд у листах — CoinSaveKeeper). Подальша робота — точкові `feat`/`fix` за запитами фронтенду.
- Модулі: auth (Google + email/пароль, cookie-сесії + session-hint cookie, resend-verification,
  reset пароля відкликає всі сесії, email без урахування регістру), users (`PATCH /api/users/me`:
  ім'я, мова), spaces (+ invitations, default categories мовою UI через `locale` у `POST /api/spaces`),
  wallets (зміна валюти з конвертацією за сьогоднішнім курсом), categories (власна валюта бюджету,
  `monthlyLimit: null` знімає ліміт), expenses, transfers (переказ між гаманцями — рядок
  `Expense` з `type: TRANSFER` і `toWalletId`/`toAmount`; не витрата й не дохід, у totals не йде),
  recurring, analytics (+ CSV), currencies
  (`GET /api/currencies/rate`), notifications, events (Socket.IO, авторизація з httpOnly access-cookie),
  health (`GET /api/health`), mail (MJML-шаблони `en`/`uk`, plain-text частини).
- Глобально: префікс `/api`, `ValidationPipe({ whitelist, transform })`, `AppExceptionFilter`,
  `ThrottlerGuard` (100 запитів/хв). Коди помилок — `src/common/constants/error-codes.ts`.
- Валюти: frankfurter (ECB) + другий провайдер для `UAH`/`RUB` — whitelist у
  `src/common/constants/currencies.ts`. Зміна primary currency простору перераховує суми.
- Cron (Europe/Kyiv): 01:00 генерація recurring, 02:00 оновлення курсів, 09:00 нагадування.
- Часові пояси: звітні періоди рахуються в TZ користувача (`time-zone-query.decorator.ts`);
  `occurredAt` допускає 5 хв розбіжності годинника.
- Мови: `en` (дефолт для нових користувачів з 2026-10-08) і `uk`.
- OpenAPI: `/api/docs.json`; фронтенд генерує з нього клієнт, тому кожна властивість DTO має бути в
  схемі, а помилки описуються через `api-error-response.decorator.ts`.

## Інфраструктура
- VPS: `docker-compose.prod.yml` — `api`, `web` (фронтенд з окремого репо `coin-save-app`),
  `db`, `db-backup`, `caddy` (`/api/*` і `/socket.io/*` → api, решта → web; спільний origin
  потрібен для auth-cookie). Деплой сервісу: `./deploy.sh api|web <sha>`.
- Міграції застосовуються при старті контейнера (`docker-entrypoint.sh`).
- Продовий `.env` генерується CI з GitHub Environment `production` — на VPS вручну не редагується.
  Нова змінна → додати в `.env.example` **і** замапити в кроці «Render .env» у
  `.github/workflows/ci-cd.yml` (CI це перевіряє).

## Процес роботи
- Одна задача = одна гілка від `main` з префіксом `feat/`, `fix/`, `perf/`, `ci/`, `chore/` → PR у `main`.
  Коміти — Conventional Commits англійською (`feat: ...`, `fix: ...`), тіло пояснює «чому».
- CI (job `check` лише на PR): eslint `--max-warnings=0`, `prettier --check`, typecheck, unit,
  integration, build, `node scripts/ci/check-openapi-dtos.js`. Мерж у `main` → build образу → деплой
  лише останнього коміту. `main` захищена (обов'язковий зелений `check`).
- Плани реалізації попередніх модулів — `docs/superpowers/plans/` (локально, не в git).

## Правила для агента
- Перед завершенням задачі обов'язково прогнати `npm run build`, `npm run lint`,
  `npm run typecheck`, `npm run test`, `npm run test:e2e`. Зауваж: `npm run lint` запускається з `--fix`
  і може змінювати файли; CI додатково робить `prettier --check` і перевірку OpenAPI-DTO (після build).
- Не чіпати: `prisma/migrations` (згенеровані), `.env`-файли, секрети, `docker-compose`/CI-конфіги
  без явного запиту.
- У логи не потрапляють паролі, токени, персональні дані.
- Один PR = одна задача. Не робити побічних рефакторингів.
- Специфікація в `docs/specs/` — джерело істини щодо вимог, але не комітиться в git.
