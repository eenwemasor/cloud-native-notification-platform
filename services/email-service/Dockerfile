# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/package.json
COPY services/email-service/package.json services/email-service/package.json
COPY services/gateway/package.json services/gateway/package.json

RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json .
COPY packages/schemas/ packages/schemas/
COPY services/email-service/ services/email-service/

RUN npm run build --workspace=services/email-service

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/email-service/dist ./dist
COPY --from=builder /app/services/email-service/package.json .
COPY --from=builder /app/node_modules ./node_modules

USER node

CMD ["node", "dist/index.js"]
