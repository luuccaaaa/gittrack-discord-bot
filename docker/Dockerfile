FROM node:22-alpine AS base
# Install curl for health checks
RUN apk add --no-cache curl

# 1. Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /usr/src/app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN \
    if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm install; \
    elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
    else echo "Lockfile not found." && npm install; \
    fi

# 2. Rebuild the source code only when needed
FROM base AS builder
WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED=1

# If using Prisma, generate the Prisma Client
# Ensure prisma/schema.prisma is copied before this step
RUN npx prisma generate

# If you are using TypeScript, uncomment the following line to build the project
# RUN npm run build

# 3. Production image, copy all necessary production artifacts
FROM base AS runner
WORKDIR /usr/src/app

ENV NODE_ENV=production

# Create a non-root user and group for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production dependencies and package.json
COPY --from=deps --chown=appuser:appgroup /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /usr/src/app/package.json ./package.json

# Copy application code
COPY --from=builder --chown=appuser:appgroup /usr/src/app/src ./src

# Copy Prisma schema and generated client
COPY --from=builder --chown=appuser:appgroup /usr/src/app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /usr/src/app/node_modules/.prisma ./node_modules/.prisma

# Create logs directory and set permissions
RUN mkdir -p /usr/src/app/logs && \
    chown -R appuser:appgroup /usr/src/app

# Switch to the non-root user
USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
