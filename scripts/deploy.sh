#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

DEPLOY_HOST="${DEPLOY_HOST:-peeeq.de}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/simple-language-learning}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-simple-language-learning}"


required_commands=(
  npm
  rsync
  ssh
  ssh-keyscan
  cp
  mkdir
  mktemp
)

for command_name in "${required_commands[@]}"; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command not found: ${command_name}" >&2
    exit 1
  fi
done

SSH_OPTIONS=(
  -p "${DEPLOY_PORT}"
)

if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  SSH_OPTIONS+=(-i "${DEPLOY_SSH_KEY}")
fi

# mkdir -p "${HOME}/.ssh"
# ssh-keyscan -p "${DEPLOY_PORT}" -H "${DEPLOY_HOST}" >> "${HOME}/.ssh/known_hosts" 2>/dev/null || true

echo "Installing dependencies"
npm ci

echo "Building standalone server"
npm run build

echo "Running tests"
npm test

echo "Running lint"
npm run lint

DEPLOY_BUNDLE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/simple-language-learning-deploy.XXXXXX")"
trap 'rm -rf "${DEPLOY_BUNDLE_DIR}"' EXIT

echo "Preparing standalone bundle"
cp -R .next/standalone/. "${DEPLOY_BUNDLE_DIR}/"
cp -R public "${DEPLOY_BUNDLE_DIR}/"
mkdir -p "${DEPLOY_BUNDLE_DIR}/.next"
cp -R .next/static "${DEPLOY_BUNDLE_DIR}/.next/"

echo "Syncing bundle to server"
rsync -avz --delete \
  --no-perms \
  --chmod=Du=rwx,Dg=rwx,Do=rx,Fu=rw,Fg=rw,Fo=r \
  -e "ssh ${SSH_OPTIONS[*]}" \
  "${DEPLOY_BUNDLE_DIR}/" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"

echo "Restarting application service"
ssh "${SSH_OPTIONS[@]}" \
  "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "sudo systemctl restart '${DEPLOY_SERVICE}'"

echo "Deployment complete"
