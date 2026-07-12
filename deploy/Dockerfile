# Prod image build (Vezdepost). Replaces upstream Dockerfile.dev for our
# deploys — wired up via build.dockerfile in docker-compose.override.yaml.
# Upstream Dockerfile.dev stays untouched (weekly upstream-sync).
#
# Differences from upstream Dockerfile.dev:
#   - base image pinned by digest (Docker Hub 429 workaround)
#   - dependency layer built with `pnpm fetch` from the lockfile BEFORE
#     `COPY . /app`, so code-only commits reuse the cached store instead of
#     re-downloading everything (~20 min -> minutes)
#   - prisma CLI pre-warmed into the pnpm dlx cache: the root postinstall runs
#     `pnpm dlx prisma generate` on every install, keep it off the network
FROM node:22.20-bookworm-slim@sha256:b21fe589dfbe5cc39365d0544b9be3f1f33f55f3c86c87a76ff65a02f8f5848e

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3-pip \
    bash \
    nginx \
&& rm -rf /var/lib/apt/lists/*

RUN addgroup --system www \
 && adduser --system --ingroup www --home /www --shell /usr/sbin/nologin www \
 && mkdir -p /www \
 && chown -R www:www /www /var/lib/nginx

RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1 pm2

WORKDIR /app

# Dependency layer: rebuilt only when the lockfile / .npmrc / root manifest
# changes. .npmrc must come along — it points at the npmmirror registry.
COPY .npmrc package.json pnpm-lock.yaml /app/
# dlx cache expires after 24h by default; pin it so the pre-warmed prisma CLI
# (incl. downloaded engines) is still valid at the next deploy
RUN pnpm config set --global dlx-cache-max-age 525600 \
 && pnpm fetch \
 && pnpm dlx prisma@6.5.0 --version

# NEXT_PUBLIC_* below the dependency layer: changing them must not refetch deps
ARG NEXT_PUBLIC_VERSION
ENV NEXT_PUBLIC_VERSION=$NEXT_PUBLIC_VERSION
ARG NEXT_PUBLIC_GTM_ID
ENV NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID

COPY . /app
COPY var/docker/nginx.conf /etc/nginx/nginx.conf

RUN pnpm install --offline --frozen-lockfile
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build

CMD ["sh", "-c", "nginx && pnpm run pm2"]