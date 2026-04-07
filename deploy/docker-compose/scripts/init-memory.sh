#!/bin/bash
# PostgreSQL initialization script for YCLAW memory system.
# Mounted at /docker-entrypoint-initdb.d/ — runs once on first container start.
# The memory package migrations handle schema creation; this ensures the
# database and user exist with correct permissions.

set -euo pipefail

echo "YCLAW: Initializing memory database..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Ensure pgcrypto extension is available (used for UUIDs)
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- Grant all privileges to the yclaw user on the memory database
    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_USER};

    -- Set default search path
    ALTER DATABASE ${POSTGRES_DB} SET search_path TO public;
EOSQL

echo "YCLAW: Memory database initialized."
