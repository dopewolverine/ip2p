#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Use a dedicated backup credential}"
: "${BACKUP_AGE_RECIPIENT:?Set the public age recipient}"
: "${BACKUP_DESTINATION:?Set a different-provider rclone remote path}"
command -v pg_dump >/dev/null
command -v age >/dev/null
command -v rclone >/dev/null
backup_name="ip2p-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
# Pipe directly into encryption: no plaintext database dump is written.
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --no-owner | age -r "$BACKUP_AGE_RECIPIENT" | rclone rcat "$BACKUP_DESTINATION/$backup_name"
printf 'Encrypted backup uploaded: %s\n' "$backup_name"
