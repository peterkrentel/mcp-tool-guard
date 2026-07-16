FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json ./gateway/package.json
COPY ui/package.json ./ui/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG VITE_MCP_URL=""
ARG VITE_PROXY_BASE_URL=""
ENV VITE_MCP_URL=${VITE_MCP_URL}
ENV VITE_PROXY_BASE_URL=${VITE_PROXY_BASE_URL}
RUN npm run build -w @mcp-tool-guard/gateway
RUN npm run build -w @mcp-tool-guard/ui

FROM nginx:1.27-alpine AS runtime
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
