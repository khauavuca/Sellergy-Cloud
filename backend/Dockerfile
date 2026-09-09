# Imagem do backend — API e worker usam a mesma. Multi-stage:
#
#   deps    — instala dependências. Tem o toolchain (python3/make/g++) porque
#             alguns pacotes tentam compilar addon nativo quando não acham
#             binário pré-compilado pra plataforma (msgpackr-extract do BullMQ,
#             sharp opcional do Baileys) — em ARM64/musl isso acontece.
#   runtime — só o que roda: node_modules pronto, código, Chromium do sistema
#             e OpenSSL (Prisma). Sem toolchain, sem cache do npm. Processo
#             roda como usuário `node`, não root.
#
# Chromium: o pacote "puppeteer" baixaria um binário glibc que não roda em
# Alpine (musl). Por isso instalamos o chromium do apk e usamos puppeteer-core
# apontado pro binário do sistema (PUPPETEER_EXECUTABLE_PATH).
#
# Prisma: `npx prisma migrate deploy` roda no START do container (ver compose),
# então o CLI do prisma precisa estar na imagem final — por isso `npm ci` sem
# --omit=dev (custo: o nodemon a mais; aceitável).

# ---------- etapa 1: dependências ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ linux-headers openssl
COPY package.json package-lock.json ./
# `npm ci` instala EXATAMENTE o package-lock (build reproduzível) e falha se o
# lock estiver dessincronizado do package.json, em vez de "consertar" sozinho.
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma/
RUN npx prisma generate

# ---------- etapa 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl chromium
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# node_modules pronto (com o client do Prisma gerado) vem da etapa anterior;
# o .dockerignore garante que o COPY do código não traz node_modules local.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node
EXPOSE 3333
CMD ["npm", "start"]
