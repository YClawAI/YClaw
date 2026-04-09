#!/bin/sh
# Populate Fargate ephemeral volumes from image backup, then drop to node.
#
# Fargate ephemeral volumes mount as empty directories, shadowing Docker COPY'd
# content. We keep a read-only backup at /app/.image-data/ and copy it into
# the writable mount points at container start.

# Copy image-baked content into empty ephemeral volumes (no-clobber)
if [ -d /app/.image-data/departments ] && [ -z "$(ls -A /app/departments 2>/dev/null)" ]; then
  cp -a /app/.image-data/departments/. /app/departments/
fi
if [ -d /app/.image-data/prompts ] && [ -z "$(ls -A /app/prompts 2>/dev/null)" ]; then
  cp -a /app/.image-data/prompts/. /app/prompts/
fi
if [ -d /app/.image-data/memory ] && [ -z "$(ls -A /app/memory 2>/dev/null)" ]; then
  cp -a /app/.image-data/memory/. /app/memory/
fi

# Fix ownership of ephemeral volume mounts (created as root:root)
chown -R node:node /app/departments /app/prompts /app/memory /app/logs /app/tmp
chown -R node:node /app/tmp/codegen 2>/dev/null || true
chown node:node /app/packages/core/src/actions/custom 2>/dev/null || true

exec su-exec node "$@"
