#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Use an EMPTY disposable database}"
: "${BACKUP_OBJECT:?Set encrypted rclone object path}"
: "${BACKUP_AGE_IDENTITY_FILE:?Set private age identity file}"
: "${CONFIRM_DISPOSABLE_RESTORE:?Must equal YES}"
[[ "$CONFIRM_DISPOSABLE_RESTORE" = YES ]] || exit 1
[[ "$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" = 0 ]] || { echo 'Restore target is not empty'; exit 1; }
rclone cat "$BACKUP_OBJECT" | age -d -i "$BACKUP_AGE_IDENTITY_FILE" | pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS users FROM users' -c 'SELECT count(*) AS encrypted_wallets FROM wallet_blobs' -c 'SELECT count(*) AS contracts FROM contracts'
echo 'Restore completed. Compare counts with the backup manifest before sign-off.'
