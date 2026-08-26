# syntax=docker/dockerfile:1

# Which stage supplies the static bundle:
#   source   (default) — npm ci + vite build inside the image (self-contained)
#   prebuilt            — copy ./dist built on the host (`npm run build`)
ARG DIST_SOURCE=source

# ---- Build the Vite/React bundle inside the image -----------------------
FROM node:22-bookworm-slim AS source

WORKDIR /app

# package-lock.json resolves part of the tree through the authenticated Endor
# package firewall, so this stage needs registry credentials. Pass them as a
# BuildKit secret so they never land in a layer:
#   docker build --secret id=npmrc,src=$HOME/.npmrc -t simple-react-app-web .
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

COPY index.html vite.config.js ./
COPY src ./src

RUN npm run build

# ---- Or take a bundle built on the host ---------------------------------
FROM busybox:stable AS prebuilt

WORKDIR /app
COPY dist ./dist

# ---- Resolve whichever bundle stage was selected ------------------------
FROM ${DIST_SOURCE} AS dist

# ---- Serve it with nginx mainline (Debian) ------------------------------
FROM nginx:mainline

# Rendered by the image's entrypoint (envsubst) at container start, so the
# API backend can be repointed without rebuilding.
ENV API_UPSTREAM=http://api:3001

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=dist /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["curl", "-fsS", "http://localhost/healthz"]
