# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

# better-sqlite3 compiles from source here; the runtime stage copies the result and keeps none of these.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY db/package.json db/

FROM base AS build

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

RUN pnpm --filter @my-team/shared build \
    && pnpm --filter huddle-api build

FROM base AS deps

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter huddle-api...

FROM node:24-slim

ENV NODE_ENV=production

WORKDIR /app/apps/api

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/api/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules /app/packages/shared/node_modules

COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist

COPY --from=build /app/apps/api/package.json package.json
COPY --from=build /app/apps/api/dist dist

COPY db/*.sql /app/db/

USER node

EXPOSE 3000

CMD [ "node", "dist/src/server.js" ]
