FROM node:22-bookworm-slim
WORKDIR /app
COPY services/workflow/package*.json ./services/workflow/
RUN cd services/workflow && npm ci
RUN ln -s /app/services/workflow/node_modules /app/node_modules
COPY packages/contracts packages/contracts
RUN npm ci --prefix packages/contracts
COPY services/workflow services/workflow
RUN cd services/workflow && npm run build && cp -R migrations dist/services/workflow/
RUN mkdir -p /app/.data/files && chown -R node:node /app/.data
USER node
WORKDIR /app/services/workflow
EXPOSE 4100
CMD ["npm","start"]
