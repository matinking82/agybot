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

# Install git for repository cloning
RUN apk add --no-cache git

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

# Create agent workspace directory
RUN mkdir -p /tmp/agent-workspace

# Start the application with entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
