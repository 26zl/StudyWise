# StudyWise Dockerfile — kun for lokal utvikling via docker compose
# Brukes IKKE i produksjon (frontend deployes til Vercel, backend til Heroku)
# Base image holdes på tag-nivå i lokal dev slik at `docker pull` får siste sikkerhetsfikser
# uten at repoet må oppdateres for hver nye digest.

FROM node:24-alpine AS deps

RUN npm install -g pnpm@10.33.0

WORKDIR /app

# Kopier package-filer for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY common/package.json common/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile

FROM deps AS sources

# Kopier kildekode én gang, og bygg deretter hver target i egne stages
COPY common/ common/
COPY backend/ backend/
COPY frontend/ frontend/

FROM sources AS common-build

RUN pnpm --filter common build

FROM common-build AS backend-build

# Backend validerer fullt env-sett ved container-start; her kompilerer vi kun artefaktene.
RUN pnpm --filter backend exec tsc -p tsconfig.json

FROM common-build AS frontend-build

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG CLERK_SECRET_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY
ARG AUTH_TURNSTILE_GATE_SECRET
ARG INTERNAL_API_URL=http://backend:4000

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV CLERK_SECRET_KEY=$CLERK_SECRET_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY
ENV AUTH_TURNSTILE_GATE_SECRET=$AUTH_TURNSTILE_GATE_SECRET
ENV INTERNAL_API_URL=$INTERNAL_API_URL

RUN pnpm --filter frontend build

# --- Backend production ---
FROM node:24-alpine AS backend

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
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

# --- Frontend production ---
FROM node:24-alpine AS frontend

WORKDIR /app

COPY --from=frontend-build /app/frontend/.next/standalone ./
COPY --from=frontend-build /app/frontend/.next/static frontend/.next/static
COPY --from=frontend-build /app/frontend/public frontend/public

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "frontend/server.js"]
