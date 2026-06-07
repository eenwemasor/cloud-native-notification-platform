# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy monorepo manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/package.json
COPY services/gateway/package.json services/gateway/package.json

# Install all workspace deps using lockfile for reproducible builds
RUN npm ci --workspaces --include-workspace-root

# Copy source
COPY tsconfig.base.json .
COPY packages/schemas/ packages/schemas/
COPY services/gateway/ services/gateway/

# Compile
RUN npm run build --workspace=services/gateway

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder /app/services/gateway/dist ./dist
COPY --from=builder /app/services/gateway/package.json .
COPY --from=builder /app/node_modules ./node_modules

# Keep the Avro schemas accessible at runtime for schema registration
COPY --from=builder /app/packages/schemas/src/avro ./packages/schemas/src/avro

EXPOSE 3000

# Run as non-root
USER node

CMD ["node", "dist/index.js"]
