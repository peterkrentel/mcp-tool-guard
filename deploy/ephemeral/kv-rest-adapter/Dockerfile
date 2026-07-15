FROM node:22-alpine
WORKDIR /app
COPY deploy/ephemeral/kv-rest-adapter/package.json ./package.json
RUN npm install --omit=dev
COPY deploy/ephemeral/kv-rest-adapter/server.mjs ./server.mjs
EXPOSE 8080
CMD ["node", "server.mjs"]
