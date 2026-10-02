# Backup and recovery operations

`backup.sh` streams a custom PostgreSQL dump through age encryption into an rclone remote. Use a dedicated backup database identity, a public age recipient and storage with another provider. Keep the private age identity offline and independently backed up. Keep secrets in a root/service-owned environment file, not in cron commands or the repository.

Required backup environment: `BACKUP_DATABASE_URL`, `BACKUP_AGE_RECIPIENT`, `BACKUP_DESTINATION`. Install compatible PostgreSQL client tools, age and rclone. Schedule at the approved recovery interval using a service timer or cron, prevent overlapping runs, and alert on nonzero exit or missing expected objects. Configure destination lifecycle retention explicitly; do not silently delete historical backups from this script.

`restore-test.sh` only restores into an empty disposable database and requires `CONFIRM_DISPOSABLE_RESTORE=YES`. Required variables: `RESTORE_DATABASE_URL`, `BACKUP_OBJECT`, `BACKUP_AGE_IDENTITY_FILE`. Never point it at the application database. The script uses `--no-owner --no-acl`, so restore application/migration role permissions separately before application testing. Compare counts, inspect representative records, run migrations as needed and test login recovery and trade evidence using test-only credentials. Record duration and result of every drill.

These scripts have only been syntax-checked. Real offsite upload, decryption, restore and operator alert delivery need an actual configured environment. A scheduled logical dump gives recovery only to the dump time. Continuous recovery needs PostgreSQL WAL archiving/PITR or a validated managed-database equivalent.

Deletion removes current database content according to the implementation policy. Restored old snapshots must replay completed deletion requests before serving traffic. Backup retention and deletion notices must match the deployed policy.
