FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY ui/package.json ./ui/package.json
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w @mcp-tool-guard/gateway

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/gateway/dist ./gateway/dist
COPY --from=build /app/gateway/config.yaml ./gateway/config.yaml
COPY --from=build /app/gateway/config.prod.yaml ./gateway/config.prod.yaml
WORKDIR /app/gateway
EXPOSE 8787
CMD ["node", "dist/proxy-server.js"]
