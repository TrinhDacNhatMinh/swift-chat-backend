# =============================================================================
# Stage 1 — Dependencies
# Install ALL deps (including devDeps) needed for building.
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app

# Enable corepack so the pnpm version from package.json is used exactly
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (dev + prod) for the build stage
RUN pnpm install --frozen-lockfile


# =============================================================================
# Stage 2 — Builder
# Compile TypeScript and generate Prisma client.
# =============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable

# Copy deps from the previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Generate Prisma client for linux/alpine target
ENV NODE_ENV=production
ENV POSTGRESQL=postgresql://dummy:dummy@localhost:5432/dummy
RUN pnpm exec prisma generate

# Compile TypeScript → /app/dist
RUN pnpm build


# =============================================================================
# Stage 3 — Runner (production image)
# Lean final image — no devDependencies, no source files.
# =============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable

# Install only production dependencies in the final image
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema + generated client for runtime & migrate deploy
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

# Run as non-root for security
USER node

ENV NODE_ENV=production

EXPOSE 3000

# On startup: apply pending migrations, then start the server
CMD ["sh", "-c", "node node_modules/.bin/prisma migrate deploy && node dist/main"]
