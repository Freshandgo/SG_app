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
