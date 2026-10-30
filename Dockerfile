FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
# Build evaluates environment configuration; these are non-secret build placeholders.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build AUTH_MODE=local APP_ENV=demo npm run build
RUN mkdir -p .data/files .data/ocr && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0"]
