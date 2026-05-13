# StudyWise Dockerfile — kun for lokal utvikling via docker compose
# Brukes IKKE i produksjon (frontend deployes til Vercel, backend til Heroku)
# Base image holdes på tag-nivå i lokal dev slik at `docker pull` får siste sikkerhetsfikser
# uten at repoet må oppdateres for hver nye digest.

# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app

# Kopier package-filer for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts/prepare-husky.mjs scripts/
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile

FROM deps AS sources

# Kopier kildekode en gang, og bygg deretter hver target i egne stages
COPY common/ common/
COPY backend/ backend/
COPY frontend/ frontend/

FROM sources AS common-build

RUN pnpm --filter common build

FROM common-build AS backend-build

# Backend validerer fullt env-sett ved container-start; her kompilerer vi kun artefaktene.
RUN pnpm --filter backend exec tsc -p tsconfig.json

FROM common-build AS frontend-build

# Offentlige variabler (ikke hemmeligheter — bakes inn i klient-JS ved build)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_TURNSTILE_ENABLED=false
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY
ARG INTERNAL_API_URL=http://backend:4000
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_TURNSTILE_ENABLED=$NEXT_PUBLIC_TURNSTILE_ENABLED
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY
ENV INTERNAL_API_URL=$INTERNAL_API_URL
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL

# Hemmeligheter mountes som filer under build — havner aldri i image-laget
RUN --mount=type=secret,id=CLERK_SECRET_KEY \
    --mount=type=secret,id=AUTH_TURNSTILE_GATE_SECRET,required=false \
    CLERK_SECRET_KEY="$(cat /run/secrets/CLERK_SECRET_KEY)" \
    AUTH_TURNSTILE_GATE_SECRET="$(cat /run/secrets/AUTH_TURNSTILE_GATE_SECRET 2>/dev/null || true)" \
    pnpm --filter frontend build

# Backend runtime
FROM node:24-alpine AS backend

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/prepare-husky.mjs scripts/
COPY common/package.json common/
COPY backend/package.json backend/

RUN pnpm install --prod --filter backend... --frozen-lockfile

COPY --from=backend-build /app/common/dist common/dist
COPY --from=backend-build /app/common/package.json common/
COPY --from=backend-build /app/backend/dist backend/dist

RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "backend/dist/index.js"]

# Frontend runtime
FROM node:24-alpine AS frontend

WORKDIR /app

COPY --from=frontend-build /app/frontend/.next/standalone ./
COPY --from=frontend-build /app/frontend/.next/static frontend/.next/static
COPY --from=frontend-build /app/frontend/public frontend/public

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "frontend/server.js"]
