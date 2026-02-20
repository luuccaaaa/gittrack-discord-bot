#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.dev.yml"
ENV_FILE="$PROJECT_ROOT/.env"

usage() {
  cat <<USAGE
Usage: ./scripts/deploy.sh [up|down|logs|ps|studio] [extra docker compose args]

Commands:
  up      Start bot + postgres (default)
  down    Stop and remove local stack
  logs    Tail bot logs (or pass compose log args/services)
  ps      Show service status
  studio  Start Prisma Studio profile
USAGE
}

require_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: $ENV_FILE was not found."
    echo "Create it from .env.example before starting the stack."
    exit 1
  fi
}

require_env_var() {
  local var_name="$1"
  local line
  line="$(grep -E "^[[:space:]]*${var_name}=" "$ENV_FILE" | tail -n 1 || true)"

  if [[ -z "$line" ]]; then
    echo "Error: $var_name is missing in $ENV_FILE"
    exit 1
  fi

  local value="${line#*=}"
  value="${value//[[:space:]]/}"
  if [[ -z "$value" ]]; then
    echo "Error: $var_name is empty in $ENV_FILE"
    exit 1
  fi
}

validate_required_env() {
  require_env_file
  require_env_var "DISCORD_TOKEN"
  require_env_var "CLIENT_ID"
  require_env_var "DATABASE_URL"
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

command_name="${1:-up}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  up)
    validate_required_env
    compose up -d --build "$@"
    echo "Bot: http://localhost:3000"
    echo "Health: http://localhost:3000/health"
    ;;
  down)
    compose --profile tools down --remove-orphans "$@"
    ;;
  logs)
    if [[ $# -gt 0 ]]; then
      compose logs -f "$@"
    else
      compose logs -f bot
    fi
    ;;
  ps)
    compose ps "$@"
    ;;
  studio)
    validate_required_env
    compose --profile tools up -d postgres prisma-studio "$@"
    echo "Prisma Studio: http://localhost:5555"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command_name"
    usage
    exit 1
    ;;
esac
