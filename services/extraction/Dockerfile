FROM node:22-bookworm-slim
WORKDIR /app
COPY services/extraction/package*.json ./services/extraction/
RUN cd services/extraction && npm ci
RUN ln -s /app/services/extraction/node_modules /app/node_modules
COPY packages/contracts packages/contracts
RUN npm ci --prefix packages/contracts
COPY services/extraction services/extraction
RUN cd services/extraction && npm run build && cp -R migrations dist/services/extraction/
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
WORKDIR /app/services/extraction
EXPOSE 4200
CMD ["npm","start"]
