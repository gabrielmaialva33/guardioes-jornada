#!/usr/bin/env bash
# Builds the app and publishes it to the VPS as a new release, then switches
# the `current` symlink atomically. Keeps the last 5 releases for rollback.
#
#   DEPLOY_HOST=root@<server> pnpm deploy:vps
#   DEPLOY_HOST=root@<server> deploy/vps.sh --rollback   # previous release
set -euo pipefail

HOST="${DEPLOY_HOST:?Set DEPLOY_HOST, e.g. root@your-server}"
APP_DIR=/var/www/guardioes-jornada
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--rollback" ]]; then
	ssh "$HOST" "set -e; cd $APP_DIR/releases; prev=\$(ls -1t | sed -n 2p); test -n \"\$prev\"; ln -sfn $APP_DIR/releases/\$prev $APP_DIR/current.tmp; mv -Tf $APP_DIR/current.tmp $APP_DIR/current; echo \"Rolled back to \$prev\""
	exit 0
fi

release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
pnpm build
rsync -az --delete build/ "$HOST:$APP_DIR/releases/$release/"
ssh "$HOST" "set -e
	ln -sfn $APP_DIR/releases/$release $APP_DIR/current.tmp
	mv -Tf $APP_DIR/current.tmp $APP_DIR/current
	cd $APP_DIR/releases && ls -1t | tail -n +6 | xargs -r rm -rf --"
echo "Published $release"
