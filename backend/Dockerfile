# Builds from source inside the image, so what runs is exactly what is in
# the repository.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
# Migrations: docker compose run --rm backend node dist/src/db/migrate.js
CMD ["node", "dist/src/server.js"]
