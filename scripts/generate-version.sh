#!/bin/bash

# Writes the version string into a file that ships inside the image. The container
# has no .git, so the value has to be frozen at build time --
# client/src/core/Version.ts reads this file at runtime and reports it to the server.
#
# Target path is the first argument
TARGET_PATH=$1

if [ -z "$TARGET_PATH" ]; then
    echo "Usage: $0 <target-path>"
    exit 1
fi

# The root manifest, resolved from this script rather than from the caller's working
# directory -- the workspace build scripts run from their own folder.
ROOT_PACKAGE_JSON="$(cd "$(dirname "$0")/.." && pwd)/package.json"

get_version() {
    # 1. APP_VERSION wins. CI passes the released version or <branch>-<sha> down as a
    #    build argument.
    if [ -n "$APP_VERSION" ]; then
        echo "$APP_VERSION"
        return
    fi

    # 2. The version semantic-release maintains in the root package.json. It is the
    #    single source of truth for a release; the git lookups only describe a
    #    working tree that is between releases.
    if [ -f "$ROOT_PACKAGE_JSON" ]; then
        if VERSION=$(node -p "require('$ROOT_PACKAGE_JSON').version" 2>/dev/null) &&
            [ -n "$VERSION" ] && [ "$VERSION" != "undefined" ]; then
            # A tag on this exact commit means the tree *is* that release. Anything
            # else gets the commit appended, so a build between releases is never
            # mistaken for the release itself.
            if [ -d ".git" ] && git describe --tags --exact-match >/dev/null 2>&1; then
                echo "$VERSION"
            elif HASH=$(git rev-parse --short HEAD 2>/dev/null); then
                DIRTY=$(git status --porcelain 2>/dev/null | grep -q . && echo "-dirty" || echo "")
                echo "${VERSION}+${HASH}${DIRTY}"
            else
                echo "$VERSION"
            fi
            return
        fi
    fi

    # 3. Fallback for a checkout without a readable manifest: branch + hash.
    BRANCH=${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")}

    if [ -n "$GITHUB_SHA" ]; then
        HASH=$(echo "$GITHUB_SHA" | cut -c1-7)
    else
        HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    fi

    DIRTY=$([ -d ".git" ] && git status --porcelain 2>/dev/null | grep -q . && echo "-dirty" || echo "")

    echo "${BRANCH}-${HASH}${DIRTY}"
}

VERSION=$(get_version)
ABSOLUTE_PATH=$(readlink -f "$TARGET_PATH" 2>/dev/null || echo "$TARGET_PATH")
DIR=$(dirname "$ABSOLUTE_PATH")

# Create directory if it doesn't exist
mkdir -p "$DIR"

# Write version to file
echo -n "$VERSION" > "$ABSOLUTE_PATH"

echo "Version $VERSION written to $ABSOLUTE_PATH"
