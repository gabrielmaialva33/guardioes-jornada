#!/bin/sh
# Forced command for the CI deploy key (see authorized_keys of guardioes-deploy).
# The key can do exactly two things and nothing else, not even open a shell:
#   rsync ... <release>/   upload a new release into the releases directory
#   activate <release>     point `current` at that release and keep the last 5
set -eu

APP=/var/www/guardioes-jornada
RELEASES="$APP/releases"

case "${SSH_ORIGINAL_COMMAND:-}" in
"rsync --server"*)
	# rrsync confines rsync to the releases directory; -wo forbids downloads.
	exec /usr/bin/rrsync -wo "$RELEASES"
	;;
"activate "*)
	release=${SSH_ORIGINAL_COMMAND#activate }
	case "$release" in
	"" | *[!A-Za-z0-9_-]*)
		echo "invalid release name" >&2
		exit 2
		;;
	esac
	if [ ! -f "$RELEASES/$release/index.html" ]; then
		echo "release $release not found" >&2
		exit 3
	fi
	ln -sfn "$RELEASES/$release" "$APP/current.tmp"
	mv -Tf "$APP/current.tmp" "$APP/current"
	# Names start with a UTC timestamp, so name order is age order (rsync -a keeps
	# the source mtimes, which makes ls -t unreliable). Never remove the active one.
	cd "$RELEASES" && ls -1 | sort -r | tail -n +6 | grep -vx "$release" | xargs -r rm -rf --
	echo "activated $release"
	;;
*)
	echo "command not allowed" >&2
	exit 1
	;;
esac
