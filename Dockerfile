# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client (provide dummy URL for generation)
ENV DATABASE_URL="mysql://user:pass@localhost:3306/db"
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install production dependencies plus prisma CLI for migrations
RUN npm ci --only=production && npm install prisma

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose the application port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Start the application with entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
