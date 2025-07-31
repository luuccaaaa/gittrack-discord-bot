#!/bin/bash

# GitTrack Discord Bot Production Deployment Script
# This script deploys the bot using Docker Compose for production

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the project root directory (parent of scripts)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 Deploying GitTrack Discord Bot (Production)..."

# Change to project root directory
cd "$PROJECT_ROOT"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with your production configuration."
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

# Stop any existing services
echo "🛑 Stopping existing services..."
docker-compose -f docker/docker-compose.prod.yml down

# Build and start the production services
echo "🔨 Building and starting production services..."
docker-compose -f docker/docker-compose.prod.yml build --no-cache
docker-compose -f docker/docker-compose.prod.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 15

# Setup database schema
echo "🗄️ Setting up database schema..."
docker-compose -f docker/docker-compose.prod.yml exec bot sh -c "
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
docker-compose -f docker/docker-compose.prod.yml ps

# Get the server IP/domain for webhook configuration
echo "🌐 Bot is running on port 3000"
echo "📋 Webhook URL: http://$(hostname -I | awk '{print $1}'):3000/github-webhook"
echo "   (Replace with your domain if you have one configured)"

echo "✅ GitTrack Discord Bot deployed successfully in production!"
echo "📊 Check logs with: docker-compose -f docker/docker-compose.prod.yml logs -f bot"
echo "🔧 To stop: docker-compose -f docker/docker-compose.prod.yml down" 