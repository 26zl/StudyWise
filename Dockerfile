# StudyWise Dockerfile — kun for lokal utvikling via docker compose
# Brukes IKKE i produksjon (frontend deployes til Vercel, backend til Heroku)

FROM node:22-alpine AS base

RUN npm install -g pnpm@10.28.2

WORKDIR /app

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG CLERK_SECRET_KEY
ARG INTERNAL_API_URL=http://backend:4000

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV CLERK_SECRET_KEY=$CLERK_SECRET_KEY
ENV INTERNAL_API_URL=$INTERNAL_API_URL

# Kopier package-filer for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

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

# --- Backend production ---
FROM node:22-alpine AS backend

RUN npm install -g pnpm@10.28.2

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY common/package.json common/
COPY backend/package.json backend/

RUN pnpm install --prod --filter backend... --frozen-lockfile

COPY --from=base /app/common/dist common/dist
COPY --from=base /app/common/package.json common/
COPY --from=base /app/backend/dist backend/dist

RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]

# --- Frontend production ---
FROM node:22-alpine AS frontend

WORKDIR /app

COPY --from=base /app/frontend/.next/standalone ./
COPY --from=base /app/frontend/.next/static frontend/.next/static
COPY --from=base /app/frontend/public frontend/public

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "frontend/server.js"]
