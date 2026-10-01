# ---- deps: install all dependencies (build-time) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript, generate Prisma client ----
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate only needs the schema file, not a reachable database —
# this placeholder URL satisfies prisma.config.ts's env("DATABASE_URL")
# read without requiring real secrets at build time.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN npx prisma generate
RUN npm run build

# ---- prod-deps: production-only node_modules ----
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN npx prisma generate

# ---- runtime: minimal final image ----
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
# NOTE: the compiled entry point is dist/src/main.js, not dist/main.js —
# tsconfig has no explicit rootDir, so tsc's inferred rootDir is the project
# root (it also compiles root-level files like prisma.config.ts), which nests
# everything under src/ beneath dist/src/. This differs from the existing
# start:prod script ("node dist/main"), which is itself consequently broken;
# fixing that build-output layout is out of scope for this Docker task.
CMD ["node", "dist/src/main"]
