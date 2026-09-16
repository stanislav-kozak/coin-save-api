# Проєкт coin-save-api

Бекенд для **CoinSave** — сімейного трекера витрат. Повна специфікація лежить
локально в `docs/specs/` (не в git — див. `.gitignore`).

## Стек
- Backend: NestJS (TypeScript), Node.js
- ORM: Prisma
- БД: Neon Postgres (гілки `main` / `develop`)
- Auth: Passport (`google`, `local`, `jwt`), `@nestjs/jwt`, `argon2` (хешування паролів і refresh-токенів)
- Realtime: Socket.IO (invalidation events по кімнатах простору)
- Cron: `@nestjs/schedule` (генерація recurring-транзакцій, нагадування, оновлення курсів валют)
- Email: Resend (SMTP) через `@nestjs-modules/mailer`, шаблони MJML + Handlebars
- Курси валют: `api.frankfurter.dev`, кеш у таблиці `ExchangeRate`
- Логи: `pino` (структуровані, у stdout)
- Error tracking: Sentry
- Rate limiting: `@nestjs/throttler`
- API-контракт: OpenAPI (`@nestjs/swagger`), фронтенд генерує типізований клієнт
- Менеджер пакетів: npm
- Тести: vitest (unit), `@testcontainers/postgresql` (integration), Playwright (E2E)
- Деплой: Docker + GitHub Container Registry, Caddy reverse proxy на VPS, GitHub Actions CI/CD

## Команди
- Встановити залежності: `npm install`
- Запустити дев-сервер: `npm run start:dev`
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
  `expenses/`, `recurring/`, `analytics/`, `currencies/`, `notifications/`, `events/`,
  `common/`, `prisma/`, `mail/`.
- Грошові суми — виключно `Decimal(19, 4)`, ніколи `Float`.
- Помилки API повертаються як `{ statusCode, code, message, details }` —
  код, а не локалізований текст (локалізація на фронтенді).
- Guards композиційно: `JwtAuthGuard` → `SpaceMemberGuard` → `SpaceOwnerGuard`.

## Правила для агента
- Перед завершенням задачі обов'язково прогнати тести (`npm run test`) та лінтер (`npm run lint`).
- Не чіпати: `prisma/migrations` (згенеровані), `.env`-файли, секрети, `docker-compose`/CI-конфіги
  без явного запиту.
- У логи не потрапляють паролі, токени, персональні дані.
- Один PR = одна задача. Не робити побічних рефакторингів.
- Специфікація в `docs/specs/` — джерело істини щодо вимог, але не комітиться в git.
