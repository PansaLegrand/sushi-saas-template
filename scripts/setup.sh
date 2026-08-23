#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile=""
non_interactive=false
skip_install=false

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [development|production] [options]

Profiles:
  development  Install dependencies, configure local values, start Docker
               database/cache/storage services, and apply all local migrations.
  production   Prepare and validate a gitignored production profile only.
               It never deploys or migrates a database.

Options:
  --non-interactive  Accept defaults and leave external provider keys blank;
                     production validation still fails until they are set.
  --skip-install     Do not run pnpm install.
  -h, --help         Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    development|dev|local)
      profile="development"
      ;;
    production|prod)
      profile="production"
      ;;
    --non-interactive)
      non_interactive=true
      ;;
    --skip-install)
      skip_install=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$profile" ]]; then
  if [[ -t 0 ]]; then
    printf 'Set up which environment? [development/production] (development): '
    read -r profile
    profile="${profile:-development}"
    case "$profile" in
      development|dev|local) profile="development" ;;
      production|prod) profile="production" ;;
      *) printf 'Unknown environment: %s\n' "$profile" >&2; exit 1 ;;
    esac
  else
    profile="development"
  fi
fi

for command_name in node pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required but was not found in PATH.\n' "$command_name" >&2
    exit 1
  fi
done

cd "$repo_root"

if [[ "$skip_install" == false ]]; then
  printf '\n\033[1m▸ Dependencies\033[0m\n'
  pnpm install
fi

configure_args=("$profile")
if [[ "$non_interactive" == true ]]; then
  configure_args+=("--non-interactive")
fi

node scripts/configure-env.mjs "${configure_args[@]}"

if [[ "$profile" == "development" ]]; then
  node scripts/setup-dev.mjs
  pnpm env:check:dev
else
  pnpm env:check:prod
  printf '\nProduction values are valid. Copy them into the hosting provider secret manager; do not commit the profile.\n'
fi
