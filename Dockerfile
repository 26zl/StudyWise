# StudyWise Production Dockerfile
# Bygger frontend og backend i én container

FROM node:20-alpine AS base

RUN apk add --no-cache wget && \
    npm install -g pnpm@10.28.2

WORKDIR /app

# Kopier package files for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Installer dependencies
RUN pnpm install --frozen-lockfile

# Kopier kildekode
COPY common/ common/
COPY backend/ backend/
COPY frontend/ frontend/

# Bygg alle pakker
ENV CI=true
RUN pnpm --filter common build && \
    pnpm --filter backend build && \
    pnpm --filter frontend build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache wget && \
    npm install -g pnpm@10.28.2

WORKDIR /app

# Kopier workspace-filer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY common/package.json common/
COPY backend/package.json backend/

# Installer kun prod dependencies
RUN pnpm install --prod --filter backend... --frozen-lockfile

# Kopier bygde filer
COPY --from=base /app/common/dist common/dist
COPY --from=base /app/common/package.json common/
COPY --from=base /app/backend/dist backend/dist
COPY --from=base /app/frontend/.next/standalone ./
COPY --from=base /app/frontend/.next/static frontend/.next/static
COPY --from=base /app/frontend/public frontend/public

# Sikkerhet
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start begge tjenester
CMD sh -c "node /app/backend/dist/index.js & HOSTNAME=0.0.0.0 node /app/frontend/server.js"
