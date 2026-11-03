FROM node:22-bookworm-slim
WORKDIR /app
COPY services/decision/package*.json ./services/decision/
RUN cd services/decision && npm ci
RUN ln -s /app/services/decision/node_modules /app/node_modules
COPY packages/contracts packages/contracts
RUN npm ci --prefix packages/contracts
COPY services/decision services/decision
RUN cd services/decision && npm run build && cp -R migrations dist/services/decision/
RUN mkdir -p /app/.data && chown -R node:node /app/.data
USER node
WORKDIR /app/services/decision
EXPOSE 4300
CMD ["npm","start"]
