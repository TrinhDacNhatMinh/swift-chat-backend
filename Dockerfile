# =============================================================================
# Stage 1 — Dependencies
# Install ALL deps (including devDeps) needed for building.
# =============================================================================
FROM node:20-alpine AS deps

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
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

# Copy deps from the previous stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Generate Prisma client for linux/alpine target
RUN pnpm exec prisma generate

# Compile TypeScript → /app/dist
RUN pnpm build


# =============================================================================
# Stage 3 — Runner (production image)
# Lean final image — no devDependencies, no source files.
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable

# Install production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy prisma schema & config
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate Prisma client for runtime (safest way to avoid pnpm symlink issues)
# We also install prisma CLI temporarily to run generate, and it'll be available for migrate deploy
RUN pnpm add prisma@^7.8.0 && pnpm exec prisma generate

# Change ownership to node user for security
RUN chown -R node:node /app

# Run as non-root for security
USER node

ENV NODE_ENV=production

EXPOSE 3000

# On startup: apply pending migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
