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
	ssh "$HOST" "set -e; cd $APP_DIR/releases; cur=\$(basename \$(readlink $APP_DIR/current)); prev=\$(ls -1 | sort -r | grep -vx \"\$cur\" | head -1); test -n \"\$prev\"; ln -sfn $APP_DIR/releases/\$prev $APP_DIR/current.tmp; mv -Tf $APP_DIR/current.tmp $APP_DIR/current; echo \"Rolled back to \$prev\""
	exit 0
fi

release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
pnpm build
# _headers is for Cloudflare Workers; nginx sets the same headers itself.
rsync -az --delete --exclude _headers build/ "$HOST:$APP_DIR/releases/$release/"
ssh "$HOST" "set -e
	ln -sfn $APP_DIR/releases/$release $APP_DIR/current.tmp
	mv -Tf $APP_DIR/current.tmp $APP_DIR/current
	cd $APP_DIR/releases && ls -1 | sort -r | tail -n +6 | grep -vx $release | xargs -r rm -rf --"
echo "Published $release"
