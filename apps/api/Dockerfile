# Build context = repo root (fly deploy -c infra/fly.api.toml from the root).
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/conformance/package.json packages/conformance/
RUN npm ci
COPY . .
RUN npm run build -w @atelier/web
ENV NODE_ENV=production \
    WEB_DIST=apps/web/dist \
    DB_PATH=/data/atelier.db \
    PORT=3000
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "apps/api/src/index.ts"]
