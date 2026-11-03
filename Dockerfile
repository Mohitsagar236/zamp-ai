FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
# The repository-wide type check includes service source; install its declared dependencies in the build stage.
RUN npm ci --prefix packages/contracts && npm ci --prefix services/workflow && npm ci --prefix services/extraction && npm ci --prefix services/decision
# Build evaluates environment configuration; these are non-secret build placeholders.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build AUTH_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build AUTH_SECRET=build-only-secret-change-before-use-32chars WORKFLOW_IDENTITY_SECRET=build-only-identity-secret-change-me-32chars AUTH_MODE=individual APP_ENV=demo npm run build
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/packages/contracts/src ./packages/contracts/src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/migrations/identity ./migrations/identity
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/next.config.ts ./
RUN mkdir -p .data/files .data/ocr && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0"]
