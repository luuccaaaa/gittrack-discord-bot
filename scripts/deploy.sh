#!/bin/bash

# GitTrack Discord Bot Deployment Script
# This script deploys the bot using Docker Compose

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the project root directory (parent of scripts)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying GitTrack Discord Bot..."

# Change to project root directory
cd "$PROJECT_ROOT"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with your configuration."
    echo "You can copy .env.example and fill in your values."
    exit 1
fi

# Load environment variables
source .env

# Check required environment variables
required_vars=("DISCORD_TOKEN" "CLIENT_ID" "DATABASE_URL")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: $var is not set in .env file"
        exit 1
    fi
done

echo "✅ Environment variables validated"

# Build and start the services
echo "🔨 Building and starting services..."
docker-compose -f docker/docker-compose.dev.yml down
docker-compose -f docker/docker-compose.dev.yml build --no-cache
docker-compose -f docker/docker-compose.dev.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Setup database schema
echo "🗄️ Setting up database schema..."
docker-compose -f docker/docker-compose.dev.yml exec bot sh -c "
  if [ -d 'prisma/migrations' ] && [ \"\$(ls -A prisma/migrations)\" ]; then
    echo 'Using migrations...'
    npx prisma migrate deploy
  else
    echo 'No migrations found, using db push...'
    npx prisma db push
  fi
"

# Check if services are running
echo "🔍 Checking service status..."
docker-compose -f docker/docker-compose.dev.yml ps

echo "✅ GitTrack Discord Bot deployed successfully!"
echo "🌐 Bot is running on http://localhost:3000"
echo "📊 Check logs with: docker-compose -f docker/docker-compose.dev.yml logs -f bot" 