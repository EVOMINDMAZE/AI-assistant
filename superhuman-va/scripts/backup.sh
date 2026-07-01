#!/usr/bin/env bash
# scripts/backup.sh — backup PocketBase + Qdrant + memory-service
#
# Writes to /var/lib/superhuman-va/backups/<timestamp>/:
#   - pocketbase.tar.gz   (PB data dir)
#   - qdrant.tar.gz       (Qdrant snapshot)
#   - manifest.json       (timestamp, sizes, sha256sums)
#
# Retention: 14 days. Older backups are deleted on each run.
# Schedule: daily at 03:00 via cron.
#
# Usage:  ./scripts/backup.sh
# Env:    BACKUP_DIR (default /var/lib/superhuman-va/backups)
#         PB_DATA_DIR (default /var/lib/superhuman-va/pb_data)
#         QDRANT_DATA_DIR (default /var/lib/superhuman-va/qdrant_data)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/lib/superhuman-va/backups}"
PB_DATA_DIR="${PB_DATA_DIR:-/var/lib/superhuman-va/pb_data}"
QDRANT_DATA_DIR="${QDRANT_DATA_DIR:-/var/lib/superhuman-va/qdrant_data}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
RETENTION_DAYS=14

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$TS"
mkdir -p "$DEST"

echo "[backup] starting at $TS"
echo "[backup] destination: $DEST"

# ── PocketBase ────────────────────────────────────────────────────────────
if [ -d "$PB_DATA_DIR" ]; then
  echo "[backup] snapshotting PocketBase from $PB_DATA_DIR"
  tar -czf "$DEST/pocketbase.tar.gz" -C "$(dirname "$PB_DATA_DIR")" "$(basename "$PB_DATA_DIR")"
else
  echo "[backup] WARN: PB_DATA_DIR $PB_DATA_DIR does not exist — skipping PB"
fi

# ── Qdrant ────────────────────────────────────────────────────────────────
echo "[backup] creating Qdrant snapshot via $QDRANT_URL"
SNAPSHOT_NAME="backup-$TS"
if curl -sf -X POST "$QDRANT_URL/snapshots" >/dev/null 2>&1; then
  # The response body is JSON; we need to fetch the snapshot
  curl -sf -X POST "$QDRANT_URL/snapshots" -o "$DEST/qdrant-snapshot-info.json" || true
  # Find the latest snapshot file
  SNAPSHOT_FILE=$(find "$QDRANT_DATA_DIR/snapshots" -name "*.snapshot" -type f 2>/dev/null | sort | tail -1 || true)
  if [ -n "$SNAPSHOT_FILE" ] && [ -f "$SNAPSHOT_FILE" ]; then
    cp "$SNAPSHOT_FILE" "$DEST/qdrant.snapshot"
    rm -f "$SNAPSHOT_FILE"  # clean up the local snapshot
  else
    echo "[backup] WARN: no Qdrant snapshot file found"
  fi
else
  echo "[backup] WARN: Qdrant snapshot API unreachable at $QDRANT_URL — falling back to raw data dir"
  if [ -d "$QDRANT_DATA_DIR" ]; then
    tar -czf "$DEST/qdrant.tar.gz" -C "$(dirname "$QDRANT_DATA_DIR")" "$(basename "$QDRANT_DATA_DIR")"
  fi
fi

# ── Manifest ──────────────────────────────────────────────────────────────
echo "[backup] writing manifest.json"
PB_SIZE=$(stat -c%s "$DEST/pocketbase.tar.gz" 2>/dev/null || echo 0)
QDRANT_SIZE=$(stat -c%s "$DEST/qdrant.snapshot" "$DEST/qdrant.tar.gz" 2>/dev/null | head -1 || echo 0)
PB_SHA=$(sha256sum "$DEST/pocketbase.tar.gz" 2>/dev/null | awk '{print $1}')
QDRANT_SHA=$(sha256sum "$DEST/qdrant.snapshot" "$DEST/qdrant.tar.gz" 2>/dev/null | head -1 | awk '{print $1}')

cat > "$DEST/manifest.json" <<EOF
{
  "timestamp": "$TS",
  "files": {
    "pocketbase": { "path": "pocketbase.tar.gz", "size": $PB_SIZE, "sha256": "$PB_SHA" },
    "qdrant":     { "path": "qdrant.snapshot",  "size": $QDRANT_SIZE, "sha256": "$QDRANT_SHA" }
  }
}
EOF

# ── Retention ─────────────────────────────────────────────────────────────
echo "[backup] pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

echo "[backup] done. files:"
ls -lh "$DEST"
