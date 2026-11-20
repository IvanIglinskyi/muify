# syntax=docker/dockerfile:1
# MuiFy — one container: Express API + the built React client on one port.
#
#   docker build -t muify \
#     --build-arg VITE_FIREBASE_API_KEY=… --build-arg VITE_FIREBASE_AUTH_DOMAIN=… \
#     --build-arg VITE_FIREBASE_PROJECT_ID=… --build-arg VITE_FIREBASE_APP_ID=… .
#   docker run -p 8080:8080 -e JAMENDO_CLIENT_ID=… muify
#
# Secrets (Jamendo client id, Firebase service-account key) are NEVER baked into the image: pass them
# at run time as env variables or mounted files (see README → Deploy). The VITE_FIREBASE_* build
# args are the public Firebase *web* config (identifiers, not secrets) the browser needs anyway.

# ---- 1. Build: install all deps, type-check and build server + client ----
FROM node:22-alpine AS build
WORKDIR /app

# Dependency layers first (cached until a lockfile changes).
COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/
RUN cd server && npm ci && cd ../client && npm ci

# Public Firebase web config for the client bundle (optional: without it sign-in is off in the UI).
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

# Sources (.dockerignore keeps out node_modules, builds, .env files, keys and local data).
COPY server server
COPY client client
RUN cd server && npm run build && cd ../client && npm run build

# ---- 2. Runtime: production deps + compiled output only, non-root ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Local mode (no Firebase) keeps its JSON state here — mount a volume to keep it.
RUN mkdir -p /app/server/data-store && chown -R node:node /app/server/data-store
VOLUME ["/app/server/data-store"]

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
