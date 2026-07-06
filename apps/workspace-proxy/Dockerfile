FROM node:24-slim
WORKDIR /app
COPY apps/workspace-proxy/src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/index.mjs"]
