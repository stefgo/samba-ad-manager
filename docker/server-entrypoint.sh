#!/bin/sh
# Starts the server as the unprivileged `node` user (UID 1000).
#
# The container starts as root only so that this script can hand the writable paths to
# `node` first. An installation from before this script has a data volume that belongs
# to root, and the host file mounted as config.yaml usually does too -- a server that
# started as `node` straight away could open neither, and an update would break it.
#
# Started with `user:` in compose (not root), the script touches nothing: whoever picked
# the UID also owns the permissions.
set -eu

DATA_DIR=/app/server/backend/data
CONFIG_FILE=/app/server/config.yaml

if [ "$(id -u)" != "0" ]; then
    exec "$@"
fi

as_node() {
    setpriv --reuid=node --regid=node --init-groups -- "$@"
}

# Recursive, but only when something in it is not node's yet -- the check stops at the
# first hit, so a volume that was handed over once costs one directory walk per start.
mkdir -p "$DATA_DIR"
if [ -n "$(find "$DATA_DIR" ! -user node -print -quit)" ]; then
    echo "sadm-entrypoint: handing $DATA_DIR to user node"
    chown -R node:node "$DATA_DIR"
fi

# The server rewrites config.yaml (generated secrets, the settings page). A mounted file
# it cannot write is taken over -- which changes its owner on the host to UID 1000.
# A file it can already write keeps its owner.
if [ -f "$CONFIG_FILE" ] && ! as_node test -w "$CONFIG_FILE"; then
    echo "sadm-entrypoint: handing $CONFIG_FILE to user node"
    chown node:node "$CONFIG_FILE"
fi

exec setpriv --reuid=node --regid=node --init-groups -- "$@"
