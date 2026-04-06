#!/bin/bash
# =============================================================================
# create-kanban-issues.sh
#
# Script brukt for å opprette alle 177 tekniske Kanban-issues i GitHub Projects.
# Kjørt 2026-04-06 for å populere "Teknisk Kanban" (#25) med alle implementerte
# features i StudyWise-prosjektet.
#
# Bruk:
#   1. Sørg for at gh CLI er autentisert med project scope:
#      gh auth refresh -s read:project -s project
#   2. Oppdater PROJECT_NUMBER, OWNER, PROJECT_ID og felt-IDer under
#   3. Kjør: bash scripts/create-kanban-issues.sh
#
# Merk: Scriptet oppretter GitHub issues med labels, legger dem til i
# prosjektet, og setter status til "Done". Håndterer duplikater gracefully.
# =============================================================================

set -e

PROJECT_NUMBER=25
OWNER=26zl
PROJECT_ID="PVT_kwHOCIaP2M4BT1aR"
STATUS_FIELD_ID="PVTSSF_lAHOCIaP2M4BT1aRzhBBk_0"
DONE_OPTION_ID="98236657"
COUNT=0
ERRORS=0

create_and_add() {
  local title="$1"
  local label="$2"
  COUNT=$((COUNT + 1))

  # Opprett issue
  local issue_url
  issue_url=$(gh issue create --repo ${OWNER}/StudyWise --title "$title" --body "" --label "$label" 2>&1)
  if [ $? -ne 0 ]; then
    echo "FEIL ved opprettelse: $title"
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "[$COUNT] Opprettet: $title"

  # Legg til i prosjektet (håndterer "already exists" gracefully)
  local add_result
  add_result=$(gh project item-add $PROJECT_NUMBER --owner $OWNER --url "$issue_url" --format json 2>&1)
  local item_id
  item_id=$(echo "$add_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

  if [ -z "$item_id" ]; then
    echo "  ADVARSEL: Kunne ikke legge til i prosjektet (finnes kanskje allerede)"
    ERRORS=$((ERRORS + 1))
    return
  fi

  # Sett status til Done
  gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$DONE_OPTION_ID" > /dev/null 2>&1
  echo "  -> Done"
}

# =============================================================================
# Opprett labels (ignorerer feil hvis de allerede finnes)
# =============================================================================
echo "=== Oppretter labels... ==="
gh label create "infra" --repo ${OWNER}/StudyWise --color "0e8a16" --description "Infrastruktur og oppsett" 2>/dev/null || true
gh label create "database" --repo ${OWNER}/StudyWise --color "1d76db" --description "Database og cache" 2>/dev/null || true
gh label create "auth" --repo ${OWNER}/StudyWise --color "d93f0b" --description "Autentisering og sikkerhet" 2>/dev/null || true
gh label create "canvas" --repo ${OWNER}/StudyWise --color "f9d0c4" --description "Canvas LMS-integrasjon" 2>/dev/null || true
gh label create "ki" --repo ${OWNER}/StudyWise --color "7057ff" --description "KI/AI-funksjonalitet" 2>/dev/null || true
gh label create "frontend" --repo ${OWNER}/StudyWise --color "0075ca" --description "Frontend" 2>/dev/null || true
gh label create "backend" --repo ${OWNER}/StudyWise --color "e4e669" --description "Backend" 2>/dev/null || true
gh label create "ci-cd" --repo ${OWNER}/StudyWise --color "bfdadc" --description "CI/CD og deploy" 2>/dev/null || true
gh label create "observabilitet" --repo ${OWNER}/StudyWise --color "c5def5" --description "Observabilitet og resiliens" 2>/dev/null || true
gh label create "i18n" --repo ${OWNER}/StudyWise --color "d4c5f9" --description "Internasjonalisering" 2>/dev/null || true
gh label create "docs" --repo ${OWNER}/StudyWise --color "006b75" --description "Dokumentasjon" 2>/dev/null || true

echo "=== Starter opprettelse av issues... ==="

# =============================================================================
# PROSJEKTOPPSETT & INFRASTRUKTUR (1-13)
# =============================================================================
create_and_add "Sett opp pnpm monorepo med frontend, backend, common og docs" "infra"
create_and_add "Konfigurert TypeScript 5.9 med delte tsconfig" "infra"
create_and_add "Sett opp Next.js 16 med App Router og Turbopack" "infra"
create_and_add "Konfigurert Express 5 backend med TypeScript" "infra"
create_and_add "Sett opp Docker + docker-compose for lokal utvikling" "infra"
create_and_add "Laget Procfile for Heroku-deploy" "infra"
create_and_add "Sett opp Tailwind CSS v4 med dark mode" "infra"
create_and_add "Konfigurert ESLint for frontend og backend" "infra"
create_and_add "Sett opp pnpm workspace med filter-scripts" "infra"
create_and_add "Laget validate-env scripts for backend og frontend" "infra"
create_and_add "Sett opp common-pakke med subpath exports i package.json" "infra"
create_and_add "Konfigurert predev/prebuild scripts for riktig bygge-rekkefølge" "infra"
create_and_add "Sett opp VitePress for teknisk dokumentasjon" "infra"

# =============================================================================
# DATABASE & CACHE (14-26)
# =============================================================================
create_and_add "Sett opp MongoDB-tilkobling med Mongoose v9" "database"
create_and_add "Opprettet User-modell med Clerk-integrasjon" "database"
create_and_add "Opprettet CanvasUser-modell for Canvas-token-lagring" "database"
create_and_add "Opprettet CanvasStructure-modell for cachet Canvas-data" "database"
create_and_add "Opprettet ChatHistory-modell for KI-samtaler" "database"
create_and_add "Opprettet ContentEmbedding-modell for dokument-chunks" "database"
create_and_add "Opprettet TaskBreakdown-modell for AI-deloppgaver" "database"
create_and_add "Opprettet Arbeidsplan-modell med StudyBlock-schema" "database"
create_and_add "Opprettet AuditLog-modell for admin-sporing" "database"
create_and_add "Sett opp Redis-klient med reconnect-logikk" "database"
create_and_add "Implementert Redis cache for Canvas API-data" "database"
create_and_add "Laget database-migrasjonsscript" "database"
create_and_add "Verifisert MongoDB-indekser ved oppstart" "database"

# =============================================================================
# AUTENTISERING & SIKKERHET (27-38)
# =============================================================================
create_and_add "Integrert Clerk for JWT-basert autentisering" "auth"
create_and_add "Implementert auth-middleware med token-verifisering" "auth"
create_and_add "Laget CSRF-beskyttelse middleware" "auth"
create_and_add "Implementert rate limiting per bruker og endpoint" "auth"
create_and_add "Satt opp Helmet for HTTP-sikkerhetsheaders" "auth"
create_and_add "Implementert kryptering av Canvas-tokens (AES-256-GCM)" "auth"
create_and_add "Laget request-timeout middleware" "auth"
create_and_add "Implementert request-id middleware for sporing" "auth"
create_and_add "Laget require-role middleware for rollebasert tilgang" "auth"
create_and_add "Implementert Clerk webhook-håndtering for brukersynk" "auth"
create_and_add "Laget kontosletting med full datarydding (GDPR)" "auth"
create_and_add "Implementert auth-sync på tvers av browser-tabs (BroadcastChannel)" "auth"

# =============================================================================
# CANVAS LMS-INTEGRASJON (39-50)
# =============================================================================
create_and_add "Implementert Canvas API proxy med token-autentisering" "canvas"
create_and_add "Laget Canvas-emner endpoint (hent aktive kurs)" "canvas"
create_and_add "Laget Canvas-oppgaver endpoint med fristfiltrering" "canvas"
create_and_add "Implementert Canvas-sider/moduler-henting" "canvas"
create_and_add "Implementert Canvas-hendelser for kalender" "canvas"
create_and_add "Laget Canvas-kunngjøringer endpoint" "canvas"
create_and_add "Sett opp Canvas-sync service for bakgrunnssynkronisering" "canvas"
create_and_add "Implementert Canvas-token validering og feilhåndtering" "canvas"
create_and_add "Laget strukturerte Canvas-feilkoder (canvasErrors)" "canvas"
create_and_add "Opprettet liste over norske Canvas-institusjoner" "canvas"
create_and_add "Implementert Canvas-diagnostikk endpoint for debugging" "canvas"
create_and_add "Laget Canvas context selector (velg data KI har tilgang til)" "canvas"

# =============================================================================
# KI/AI — CHAT (51-64)
# =============================================================================
create_and_add "Integrert Anthropic Claude SDK" "ki"
create_and_add "Implementert KI-chat endpoint med streaming (SSE)" "ki"
create_and_add "Laget system prompt for studieveileder-kontekst" "ki"
create_and_add "Implementert meldingshistorikk-trimming for token-grense" "ki"
create_and_add "Laget ChatSection-komponent med fullverdig chat-UI" "ki"
create_and_add "Implementert chat-lagring med automatisk tittel" "ki"
create_and_add "Laget chathistorikk-sidebar med søk" "ki"
create_and_add "Implementert pending state for chat under navigering" "ki"
create_and_add "Laget chat-eksport til Markdown" "ki"
create_and_add "Implementert deling av KI-samtaler via token" "ki"
create_and_add "Laget delt-chat visning (/delt-chat/[shareToken])" "ki"
create_and_add "Implementert retry-knapp for feilede KI-meldinger" "ki"
create_and_add "Laget smarte oppfølgingsforslag basert på svartype" "ki"
create_and_add "Implementert auto-genererte modulspørsmål i chat" "ki"

# =============================================================================
# KI/AI — DOKUMENTANALYSE (65-69)
# =============================================================================
create_and_add "Implementert dokumentopplasting i chat (drag & drop)" "ki"
create_and_add "Laget filekstraksjon for PDF, DOCX, PPTX, TXT" "ki"
create_and_add "Implementert bilde-OCR for dokumentanalyse" "ki"
create_and_add "Laget AttachmentStrip-komponent for vedleggvisning" "ki"
create_and_add "Implementert dokumentanalyse-endpoint med Claude" "ki"

# =============================================================================
# KI/AI — OPPGAVEDELING (70-75)
# =============================================================================
create_and_add "Laget AI-oppgavedeling endpoint (bryt ned Canvas-oppgaver)" "ki"
create_and_add "Implementert SubTask-generering med prioritet og tidsestimat" "ki"
create_and_add "Laget AITaskBreakdown-komponent med redigerbare deloppgaver" "ki"
create_and_add "Implementert lagring av deloppgaver i database" "ki"
create_and_add "Laget AIBreakdownPage som helside-visning" "ki"
create_and_add "Implementert CanvasKIActions for KI-handlinger på oppgaver" "ki"

# =============================================================================
# KI/AI — UKEPLAN (76-80)
# =============================================================================
create_and_add "Laget AI-ukeplangenerering endpoint" "ki"
create_and_add "Implementert WeeklyPlanSuggestions-komponent" "ki"
create_and_add "Laget AddToWorkplanModal med dag/tid-velger" "ki"
create_and_add "Implementert conflict check mot eksisterende arbeidsplan" "ki"
create_and_add "Laget automatisk fordeling av oppgaver over valgte dager" "ki"

# =============================================================================
# KI/AI — OPPSUMMERING & QUIZ (81-84)
# =============================================================================
create_and_add "Implementert AI-oppsummering endpoint" "ki"
create_and_add "Laget KIOppsummering-komponent med kort/lang oppsummering" "ki"
create_and_add "Implementert quiz-generering med Claude" "ki"
create_and_add "Laget QuizView-komponent med Framer Motion-animasjoner" "ki"

# =============================================================================
# VEKTORSØK & RAG (85-92)
# =============================================================================
create_and_add "Sett opp Pinecone serverless med integrated embeddings" "ki"
create_and_add "Implementert tekst-chunking service for dokumenter" "ki"
create_and_add "Laget embedding-generering og lagring i Pinecone" "ki"
create_and_add "Implementert semantisk søk i dokumentembeddings" "ki"
create_and_add "Laget BM25 nøkkelordsøk-service" "ki"
create_and_add "Implementert hybrid retrieval (semantisk + BM25)" "ki"
create_and_add "Integrert Cohere rerank-v3.5 for søkeresultat-reranking" "ki"
create_and_add "Laget context-loader service for KI-kontekst fra søk" "ki"

# =============================================================================
# ARBEIDSPLAN (93-98)
# =============================================================================
create_and_add "Implementert CRUD API for arbeidsplaner" "backend"
create_and_add "Laget MinArbeidsplan-komponent med progress tracking" "frontend"
create_and_add "Implementert toggle fullført-status på studieblokker" "frontend"
create_and_add "Laget fremdriftsstatistikk endpoint (progress stats)" "backend"
create_and_add "Implementert undo ved sletting av arbeidsplan" "frontend"
create_and_add "Lagt til priority tooltips med forklaring" "frontend"

# =============================================================================
# FRONTEND — SIDER & LAYOUT (99-110)
# =============================================================================
create_and_add "Laget landing page med hero-seksjon" "frontend"
create_and_add "Implementert dashboard med tab-navigasjon (nuqs URL-synk)" "frontend"
create_and_add "Laget oversiktsside med StatCards" "frontend"
create_and_add "Implementert kalendervisning med CalendarGrid" "frontend"
create_and_add "Laget innstillinger-side med Canvas-token og AI-kontekst" "frontend"
create_and_add "Implementert varsler-seksjon med Canvas-kunngjøringer" "frontend"
create_and_add "Laget om oss-side" "frontend"
create_and_add "Laget kontakt-side" "frontend"
create_and_add "Laget personvernserklæring-side" "frontend"
create_and_add "Laget sikkerhetsinfo-side" "frontend"
create_and_add "Laget vilkår-side" "frontend"
create_and_add "Implementert profil-side med Clerk UserProfile" "frontend"

# =============================================================================
# FRONTEND — STATE & DATA (111-118)
# =============================================================================
create_and_add "Sett opp Zustand stores (kiStore, uiStore)" "frontend"
create_and_add "Konfigurert TanStack React Query med queryConfig" "frontend"
create_and_add "Implementert API-klient med auth-token (fetchApi)" "frontend"
create_and_add "Laget ki-api med alle KI-hooks og streaming" "frontend"
create_and_add "Laget canvas-api med React Query hooks" "frontend"
create_and_add "Laget arbeidsplan-api med React Query hooks" "frontend"
create_and_add "Laget calendar-api for Canvas-hendelser" "frontend"
create_and_add "Laget auth-api med brukerregistrering og /me" "frontend"

# =============================================================================
# FRONTEND — FEILHÅNDTERING & UX (119-125)
# =============================================================================
create_and_add "Implementert felles feilhåndteringsystem (errorUtils)" "frontend"
create_and_add "Laget brukervennlige norske feilmeldinger per kontekst" "frontend"
create_and_add "Implementert FeilMelding-komponent (error/warning/info)" "frontend"
create_and_add "Laget ErrorBoundary for uventede feil" "frontend"
create_and_add "Implementert toast-system med Sonner" "frontend"
create_and_add "Lagt til undo-støtte i toast (showToast.undoable)" "frontend"
create_and_add "Implementert loading states og skeleton UI" "frontend"

# =============================================================================
# FRONTEND — UI-KOMPONENTER (126-130)
# =============================================================================
create_and_add "Laget CodeBlock med syntax highlighting" "frontend"
create_and_add "Implementert ReactMarkdown med GFM og sanitizing" "frontend"
create_and_add "Laget tema-provider med dark/light mode" "frontend"
create_and_add "Implementert CookieBanner for samtykke" "frontend"
create_and_add "Laget responsive sidebar med mobil-støtte" "frontend"

# =============================================================================
# OBSERVABILITET & RESILIENS (131-137)
# =============================================================================
create_and_add "Sett opp Pino-logging med strukturerte logger" "observabilitet"
create_and_add "Implementert Datadog APM (dd-trace) for backend" "observabilitet"
create_and_add "Laget Datadog RUM-komponent for frontend" "observabilitet"
create_and_add "Implementert TelemetryConsent for brukersamtykke" "observabilitet"
create_and_add "Laget circuit breakers for Canvas og Anthropic API" "observabilitet"
create_and_add "Implementert health check endpoint" "observabilitet"
create_and_add "Laget audit logging for admin-handlinger" "observabilitet"

# =============================================================================
# INTERNASJONALISERING (138-140)
# =============================================================================
create_and_add "Sett opp i18n-system med norsk og engelsk" "i18n"
create_and_add "Laget LanguageProvider med server-side støtte" "i18n"
create_and_add "Opprettet meldingsfiler for nb og en" "i18n"

# =============================================================================
# DOKUMENTASJON (141-145)
# =============================================================================
create_and_add "Skrevet AGENTS.md med prosjektretningslinjer" "docs"
create_and_add "Skrevet CLAUDE.md som prosjektreferanse" "docs"
create_and_add "Skrevet CONTRIBUTING.md som bidragsguide" "docs"
create_and_add "Satt opp Swagger UI for API-dokumentasjon" "docs"
create_and_add "Konfigurert VitePress docs-side" "docs"

# =============================================================================
# NYE ITEMS FUNNET VED KODEBASE-ANALYSE (146-177)
# =============================================================================

# KI/AI — Nye (146-151)
create_and_add "Implementert flashcard-generering fra Canvas-innhold" "ki"
create_and_add "Laget FlashcardView-komponent med studie-modus" "ki"
create_and_add "Implementert KI-eksport til 6 formater (Markdown, PDF, Word, Excel, Text, Notion)" "ki"
create_and_add "Laget eksport-providers med builder-pattern" "ki"
create_and_add "Implementert studiekontekst-service for personaliserte KI-svar" "ki"
create_and_add "Implementert Notion-integrasjon (API-nøkkel, side-verifisering, eksport)" "ki"

# Sikkerhet & Auth — Nye (152-157)
create_and_add "Implementert nonce-basert CSP (Content Security Policy)" "auth"
create_and_add "Implementert Turnstile-verifisering for auth og kontaktskjema" "auth"
create_and_add "Laget step-up auth (requireRecentAuth) for sensitive operasjoner" "auth"
create_and_add "Implementert cross-environment re-linking (Clerk dev/prod)" "auth"
create_and_add "Laget auth conflict guard i frontend" "auth"
create_and_add "Implementert soft-delete pattern for brukere (deletedAt)" "auth"

# Infrastruktur & Resiliens — Nye (158-164)
create_and_add "Satt opp web push notifications service med VAPID" "backend"
create_and_add "Implementert web crawler for eksterne Canvas-lenker" "backend"
create_and_add "Laget kontaktskjema med Cloudflare Worker-integrasjon" "backend"
create_and_add "Implementert graceful shutdown (SIGTERM/SIGINT)" "backend"
create_and_add "Laget retry-kø for Clerk-slettinger (PendingClerkDeletion)" "backend"
create_and_add "Laget retry-kø for Pinecone vektor-slettinger (PendingVectorDeletion)" "backend"
create_and_add "Implementert memory pressure checks for Heroku-dynos" "backend"

# Frontend — Nye (165-170)
create_and_add "Laget velkomst-/onboarding-modal for nye brukere" "frontend"
create_and_add "Laget FAQ-side" "frontend"
create_and_add "Implementert smarte fristvarsler med kompleksitetsvurdering" "frontend"
create_and_add "Laget studiestatistikk endpoint og visning" "frontend"
create_and_add "Implementert auth sign-in/sign-up sider med Turnstile" "frontend"
create_and_add "Laget glemt passord-flyt" "frontend"

# Admin (171-172)
create_and_add "Implementert admin-panel med brukeradministrasjon og statistikk" "backend"
create_and_add "Laget admin audit-logg visning" "backend"

# CI/CD — Nye (173-177)
create_and_add "Satt opp CI-pipeline med actionlint, quality, dependency-scan, secret-scan, SBOM" "ci-cd"
create_and_add "Konfigurert automatisk deploy til Vercel (frontend) og Heroku (backend)" "ci-cd"
create_and_add "Laget OWASP dependency-check workflow (ukentlig)" "ci-cd"
create_and_add "Laget automatisk dependency update workflow" "ci-cd"
create_and_add "Satt opp Playwright E2E testing i CI" "ci-cd"

echo ""
echo "===== FERDIG! $COUNT issues opprettet, $ERRORS feil ====="
