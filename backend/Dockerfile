# Backend Dockerfile
FROM node:20-alpine@sha256:3960ed74dfe320a67bf8da9555b6bade25ebda2b22b6081d2f60fd7d5d430e9c AS base

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY common/package.json common/package.json
RUN pnpm install --filter backend... --frozen-lockfile

COPY tsconfig.base.json ./
COPY backend ./backend
COPY common ./common
RUN pnpm --filter common build
RUN pnpm --filter backend build

FROM node:20-alpine@sha256:3960ed74dfe320a67bf8da9555b6bade25ebda2b22b6081d2f60fd7d5d430e9c AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY common/package.json common/package.json
RUN pnpm install --prod --filter backend... --frozen-lockfile

COPY --from=base /app/backend/dist ./backend/dist
COPY --from=base /app/common/dist ./common/dist
COPY --from=base /app/common/package.json ./common/package.json

RUN chown -R node:node /app

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "backend/dist/index.js"]
