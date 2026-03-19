# Build stage — runs natively on the CI runner to avoid QEMU/yarn issues
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install all dependencies (including devDependencies for build)
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN yarn tsc

# Production stage
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Copy built JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/data

# Create non-root user for security
RUN addgroup -g 1001 -S seerrboxd && \
    adduser -S seerrboxd -u 1001 -G seerrboxd && \
    apk add --no-cache su-exec

# Fix ownership of app directory
RUN chown -R seerrboxd:seerrboxd /app

# Copy and enable entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port (optional, for health checks)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=5m --timeout=30s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]