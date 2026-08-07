# ─────────────────────────────────────────────────────────────────────────────
# PlantVisit Gmail Backend — Dockerfile
# Build + push via Cloud Build (no local npm install required)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: install dependencies inside the image ───────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first so Docker layer-cache skips npm ci on code-only changes
COPY package.json ./

# npm ci downloads nodemailer into the image — zero local npm needed
RUN npm ci --omit=dev

# ── Stage 2: lean runtime image ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Non-root user for Cloud Run security best-practice
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server.js ./
COPY package.json ./

USER appuser

# Cloud Run injects PORT; default to 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
