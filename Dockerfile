# =============================================================================
# Stage 1 — Dependencies
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile


# =============================================================================
# Stage 2 — Builder
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules

COPY . .

ENV NODE_ENV=production
ENV POSTGRESQL=postgresql://dummy:dummy@localhost:5432/dummy
RUN pnpm exec prisma generate --schema=./prisma/schema.prisma

RUN pnpm build


# =============================================================================
# Stage 3 — Runner
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

USER node

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main"]