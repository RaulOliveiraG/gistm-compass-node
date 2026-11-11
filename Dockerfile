# syntax=docker/dockerfile:1
# Multi-stage para Lightsail Containers (Node 22 Debian — não Alpine).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Inclui devDependencies (Tailwind/PostCSS) — necessárias no stage builder.
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder só no build — secrets reais entram no runtime do Lightsail.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=80
ENV HOSTNAME=0.0.0.0
# Datas e horas na tela no horário de Brasília (o servidor roda em UTC).
ENV TZ=America/Sao_Paulo
# Cabe em Lightsail Small (1 GB RAM) com margem para o SO.
ENV NODE_OPTIONS=--max-old-space-size=512

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates libcap2-bin \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs \
  # Permite USER nextjs escutar na porta 80 sem root.
  && setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"

COPY --from=builder /app/public ./public
RUN mkdir -p .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Engines do Prisma: o file tracing do standalone às vezes omite binários.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# pdf-parse + canvas nativo (DOMMatrix) — tracing do standalone costuma omitir.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@napi-rs ./node_modules/@napi-rs

USER nextjs
EXPOSE 80

# Auth redireciona / — 2xx/3xx conta como saudável.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
