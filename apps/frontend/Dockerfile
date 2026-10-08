# This app is built by @lovable.dev/vite-tanstack-config (see vite.config.ts),
# targeting Nitro's `bun` preset instead of Cloudflare Workers. `vite build`
# produces a self-contained `.output/server/index.mjs` — a plain Fetch-API/H3
# HTTP server, no node_modules or Cloudflare runtime needed alongside it.
#
# This used to build a Cloudflare Worker and serve it via `wrangler dev`
# (the only thing that can run a Workers build outside Cloudflare's own edge).
# That broke under containerd/minikube: wrangler dev spins up two separate
# `workerd` processes (a public "entry" proxy + the actual user-worker) that
# talk over a dynamically negotiated loopback link, and that link never
# completed in this environment — every request hung until the liveness
# probe killed the pod. Nitro's `bun` output is a single process with no
# such internal hop, so it behaves the same under minikube, AKS, or a plain
# `docker run`. The app itself never used Cloudflare-specific bindings (no
# KV/D1/R2) — only `process.env.STRIPE_SECRET_KEY`, which Bun/Node provide
# natively — so no application code changed, only the build target.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app

COPY --from=build /app/.output ./.output

ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", ".output/server/index.mjs"]
