# VPS Deployment

The VPS runs two local services behind Caddy:

```text
Internet -> Caddy -> Nginx container (127.0.0.1:8020) -> static web
                   -> /api -> systemd API (127.0.0.1:4000) -> SQLite
```

The Nginx container uses host networking but listens only on `127.0.0.1:8020`, allowing it to reach the loopback-only API without exposing either service as a public port. Static files are mounted directly from `current/apps/web`, so every Git release contains the exact directory expected by the container.

## Persistent paths

```text
/opt/cipc-labequip/current/                 deployed application release
/var/lib/cipc-labequip/data/production.sqlite SQLite database
/var/lib/cipc-labequip/backups/              SQLite snapshots
/etc/systemd/system/cipc-labequip-api.service
/etc/systemd/system/cipc-labequip-backup.service
/etc/systemd/system/cipc-labequip-backup.timer
/etc/systemd/system/cipc-labequip-operations.service
/etc/systemd/system/cipc-labequip-operations.timer
/etc/caddy/sites/cipc-labequip.caddy
```

Before enabling the service, create the service account and writable directories:

```bash
sudo useradd --system --home /var/lib/cipc-labequip --shell /usr/sbin/nologin cipc-labequip
sudo install -d -o cipc-labequip -g cipc-labequip /var/lib/cipc-labequip/data /var/lib/cipc-labequip/backups
sudo install -m 0644 deploy/vps/cipc-labequip-api.service /etc/systemd/system/cipc-labequip-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-api
```

Deploy `compose.yaml` and `nginx.conf` to `/opt/cipc-labequip`, then recreate the web container after a release update:

```bash
cd /opt/cipc-labequip
docker compose up -d --force-recreate web
sudo systemctl restart cipc-labequip-api
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8020/api/health
```

生产单元默认不播种演示账号。首次使用空数据库时，请按仓库根目录的 [发布、迁移与部署流程](../../docs/RELEASE_AND_MIGRATION.md) 执行一次性管理员初始化脚本；已有数据库不要重复初始化。

The unit explicitly sets `NODE_ENV=production`, the persistent absolute `DATA_FILE`, the production browser origin, `TRUST_PROXY=true`, and `COOKIE_SECURE=true`. The checked-in Caddy site is a template: replace `equip.labequip.example.edu` with the actual hostname before installation; its security headers are defined in the file rather than imported from an untracked server snippet. Proxy trust is appropriate here because the API listens only on loopback and receives traffic through the local Nginx proxy; keep it disabled when clients can reach the API directly. The provided unit expects the independently installed runtime at `/usr/local/bin/node`; adjust `ExecStart` only when `command -v node` differs.

## Backup, restore, and rollback

The backup command uses `VACUUM INTO`, then opens the snapshot separately and requires `PRAGMA integrity_check` to return `ok` before pruning older snapshots. A failed integrity check removes the invalid output and returns a non-zero exit status.

Create a verified, consistent backup while the API is running:

```bash
cd /opt/cipc-labequip/current
sudo -u cipc-labequip node scripts/backup-db.mjs \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --output-dir /var/lib/cipc-labequip/backups --keep 14
```

Install the daily backup timer from a release directory:

```bash
cd /opt/cipc-labequip/current
sudo install -m 0644 deploy/vps/cipc-labequip-backup.service /etc/systemd/system/cipc-labequip-backup.service
sudo install -m 0644 deploy/vps/cipc-labequip-backup.timer /etc/systemd/system/cipc-labequip-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-backup.timer
```

The timer runs daily at 03:15 Asia/Shanghai with up to 30 minutes of randomized delay, catches up after downtime, and retains the newest 14 verified snapshots. Change `BACKUP_RETENTION` in the service before installation when a different retention count is required.

The backup service grants write access to both the data and backup directories. Although the source database is opened with `readOnly: true`, a WAL reader may still need to create or map the adjacent `-shm` file when the API is stopped and no shared-memory file remains.

Inspect the schedule and recent results:

```bash
systemctl list-timers cipc-labequip-backup.timer
sudo systemctl status cipc-labequip-backup.timer
sudo journalctl -u cipc-labequip-backup.service -n 50 --no-pager
sudo ls -lht /var/lib/cipc-labequip/backups | head
```

Run the same oneshot immediately without changing the timer schedule:

```bash
sudo systemctl start cipc-labequip-backup.service
sudo systemctl status cipc-labequip-backup.service
```

Restore only during a maintenance window:

```bash
sudo systemctl stop cipc-labequip-api
sudo cp -a /var/lib/cipc-labequip/data/production.sqlite /var/lib/cipc-labequip/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).sqlite
sudo install -o cipc-labequip -g cipc-labequip -m 0600 BACKUP.sqlite /var/lib/cipc-labequip/data/production.sqlite
sudo rm -f /var/lib/cipc-labequip/data/production.sqlite-wal /var/lib/cipc-labequip/data/production.sqlite-shm
sudo systemctl start cipc-labequip-api
curl -fsS http://127.0.0.1:4000/api/health
```

Disable and remove the timer without deleting existing snapshots:

```bash
sudo systemctl disable --now cipc-labequip-backup.timer
sudo rm -f /etc/systemd/system/cipc-labequip-backup.timer /etc/systemd/system/cipc-labequip-backup.service
sudo systemctl daemon-reload
```

For web/code rollback, repoint `current` to the preceding release, recreate `web`, restart the API service, and verify both health endpoints. Database restore is independent and must use the snapshot procedure above.

## v1.3 operational checks

Run a disposable restore drill before and after changes to the backup procedure. The command copies the snapshot to an isolated temporary directory, verifies SQLite integrity and required tables, then removes the copy:

```bash
cd /opt/cipc-labequip/current
sudo -u cipc-labequip node scripts/restore-drill.mjs \
  --backup /var/lib/cipc-labequip/backups/BACKUP.sqlite
```

Run the combined API, database, backup-age and disk-space check:

```bash
sudo -u cipc-labequip node scripts/operations-check.mjs \
  --api http://127.0.0.1:4000/api/health \
  --data /var/lib/cipc-labequip/data/production.sqlite \
  --backup-dir /var/lib/cipc-labequip/backups \
  --max-backup-age-hours 36 \
  --min-free-mb 1024
```

The command exits non-zero when any check fails and emits structured JSON.

Install the provided 15-minute operations timer:

```bash
cd /opt/cipc-labequip/current
sudo install -m 0644 deploy/vps/cipc-labequip-operations.service /etc/systemd/system/cipc-labequip-operations.service
sudo install -m 0644 deploy/vps/cipc-labequip-operations.timer /etc/systemd/system/cipc-labequip-operations.timer
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-operations.timer
```

The operations service intentionally retains host loopback access so it can call the API. Its data path is writable because SQLite WAL readers may need to create or map the `-shm` file even when the database is opened with `readOnly: true`; the backup directory remains read-only.

Run and inspect the same service immediately:

```bash
sudo systemctl start cipc-labequip-operations.service
sudo systemctl status cipc-labequip-operations.service
sudo journalctl -u cipc-labequip-operations.service -n 50 --no-pager
systemctl list-timers cipc-labequip-operations.timer
```

Confirm that the JSON result has top-level `status: "ok"` and `checks.database.status: "ok"` on the production host. A non-zero check leaves the oneshot service in the failed state and records the complete result in the journal.

Alert delivery is a site-level integration because receiver commands, credentials, and payload formats vary. Attach the host's alert unit without editing the release-owned service:

```bash
sudo systemctl edit cipc-labequip-operations.service
```

```ini
[Unit]
OnFailure=SITE_ALERT_UNIT.service
```

Then run `sudo systemctl daemon-reload` and induce a controlled check failure to verify delivery. Keep credentials in the alert unit's protected environment or credential store rather than in this repository or the operations result.

## Developer upgrade center

Install the one-shot upgrade service and path watcher once from a v1.4.0-or-newer release:

```bash
cd /opt/cipc-labequip/current
sudo install -d -o cipc-labequip -g cipc-labequip /var/lib/cipc-labequip/data/upgrade
sudo install -m 0644 deploy/vps/cipc-labequip-upgrade.service /etc/systemd/system/cipc-labequip-upgrade.service
sudo install -m 0644 deploy/vps/cipc-labequip-upgrade.path /etc/systemd/system/cipc-labequip-upgrade.path
sudo systemctl daemon-reload
sudo systemctl enable --now cipc-labequip-upgrade.path
```

The developer-only “系统升级” page checks the stable public release, queues a request, and lets the root-owned systemd agent perform the database backup, release tests, service switch, health checks, and code rollback. Database rollback remains a separate, deliberate restore operation.
