# AirBoard — bun runtime image (bun runs the TypeScript directly; no build step)
FROM oven/bun:1.3-slim

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Application code
COPY src ./src

# Database lives on a mounted volume (docker-compose mounts ./airboard-data or a named volume here)
RUN mkdir -p /data
VOLUME /data

ENV PORT=3000 \
    DB_PATH=/data/airboard.db

EXPOSE 3000

# Bootstrap token is printed to stdout on first run (empty volume): docker logs airboard
CMD ["bun", "src/index.ts"]
