# Frontend Dockerfile
FROM node:20-alpine@sha256:3960ed74dfe320a67bf8da9555b6bade25ebda2b22b6081d2f60fd7d5d430e9c AS base

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY common/package.json common/package.json
RUN pnpm install --filter frontend... --frozen-lockfile

COPY tsconfig.base.json ./
COPY frontend ./frontend
COPY common ./common

ARG NEXT_PUBLIC_API_URL=http://backend:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN pnpm --filter common build
RUN pnpm --filter frontend build

FROM node:20-alpine@sha256:3960ed74dfe320a67bf8da9555b6bade25ebda2b22b6081d2f60fd7d5d430e9c AS production

WORKDIR /app

COPY --from=base /app/frontend/.next/standalone ./
COPY --from=base /app/frontend/.next/static ./frontend/.next/static
COPY --from=base /app/frontend/public ./frontend/public

COPY --from=base /app/common/dist ./common/dist
COPY --from=base /app/common/package.json ./common/package.json

EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=http://backend:4000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "frontend/server.js"]
