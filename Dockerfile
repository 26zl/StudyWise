# StudyWise Production Dockerfile
# Bygger både frontend og backend i én container
# Cloud Run kjører denne på PORT miljøvariabelen

FROM node:20-alpine AS base

# Installer wget for health checks og pnpm via npm (unngår corepack signatur-problemer)
RUN apk update && apk upgrade && \
    apk add --no-cache wget && \
    npm install -g pnpm@10.28.2

WORKDIR /app

# Kopier workspace-filer
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Installer alle dependencies
RUN pnpm install --frozen-lockfile

# Kopier kildekode
COPY common/ common/
COPY backend/ backend/
COPY frontend/ frontend/

# Bygg alt (CI=true hopper over miljøvalidering i prebuild)
ENV CI=true
RUN pnpm --filter common build
RUN pnpm --filter backend build
RUN pnpm --filter frontend build

# Production stage
FROM node:20-alpine AS production

# Installer wget for health checks og pnpm via npm (unngår corepack signatur-problemer)
RUN apk update && apk upgrade && \
    apk add --no-cache wget && \
    npm install -g pnpm@10.28.2

WORKDIR /app

# Kopier workspace-filer for prod install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY common/package.json common/
COPY backend/package.json backend/

# Installer kun prod dependencies for backend
RUN pnpm install --prod --filter backend... --frozen-lockfile

# Kopier bygde filer
COPY --from=base /app/common/dist common/dist
COPY --from=base /app/common/package.json common/
COPY --from=base /app/backend/dist backend/dist
COPY --from=base /app/frontend/.next/standalone ./
COPY --from=base /app/frontend/.next/static frontend/.next/static
COPY --from=base /app/frontend/public frontend/public

# Kopier oppstartsskript
COPY start.sh ./
RUN chmod +x start.sh

# Sikkerhet
RUN chown -R node:node /app
USER node

# Cloud Run setter PORT automatisk (vanligvis 8080)
ENV NODE_ENV=production

# Healthcheck for lokal Docker-testing (Cloud Run bruker egne probes og ignorerer denne)
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q --spider http://localhost:${PORT:-8080}/health || exit 1

CMD ["./start.sh"]
