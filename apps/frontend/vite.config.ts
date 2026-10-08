// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only, disabled below),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

// Build target: plain Bun/Node server via Nitro, not Cloudflare Workers.
// `wrangler dev` (the only thing that can run a Workers build outside Cloudflare's
// own edge) turned out to hang under containerd/minikube: it spawns two separate
// `workerd` processes (a public "entry" proxy + the actual user-worker) that talk
// over a dynamically negotiated loopback link, and that link never completed in
// this environment, so every request hung until the liveness probe killed the pod.
// Nitro's `bun` preset produces a self-contained `.output/server/index.mjs` that
// runs directly under Bun (see Dockerfile) — a single process, no proxy hop, works
// the same under minikube, AKS, or plain `docker run`.
// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [nitro({ preset: "bun" })],
});
