FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Production image
FROM base AS runner
WORKDIR /data

ENV NODE_ENV=production
ENV PORT=3000

# Create a non-root user with home in /data
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /data syncuser

# Copy built dependencies
COPY --from=deps /app/node_modules /data/node_modules
COPY --from=deps /app/package.json /data/package.json

# Copy source code
COPY src/ /data/src/

# Ensure keys directory exists and is writable
RUN mkdir -p /keys && chown syncuser:nodejs /data /keys

USER syncuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
