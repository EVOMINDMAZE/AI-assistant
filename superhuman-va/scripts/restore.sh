#!/usr/bin/env bash
# scripts/restore.sh <backup_date> — restore PocketBase + Qdrant from a backup.
#
# Usage:  ./scripts/restore.sh 20260701T030000Z
# Effect: stops the affected services, validates the manifest & checksums,
#         extracts PB data + Qdrant snapshot, restarts services.
#         The next user message will be processed normally.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/lib/superhuman-va/backups}"
PB_DATA_DIR="${PB_DATA_DIR:-/var/lib/superhuman-va/pb_data}"
QDRANT_DATA_DIR="${QDRANT_DATA_DIR:-/var/lib/superhuman-va/qdrant_data}"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_date_or_prefix>"
  echo "Example: $0 20260701"
  echo "(picks the most recent backup matching the prefix)"
  exit 1
fi

PREFIX="$1"
BACKUP_PATH=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name "${PREFIX}*" | sort | tail -1)
if [ -z "$BACKUP_PATH" ]; then
  echo "[restore] no backup found matching prefix '$PREFIX' in $BACKUP_DIR"
  exit 1
fi

echo "[restore] using backup at $BACKUP_PATH"

# ── Validate manifest ─────────────────────────────────────────────────────
MANIFEST="$BACKUP_PATH/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "[restore] FATAL: manifest.json missing"
  exit 1
fi

# Verify checksums
if [ -f "$BACKUP_PATH/pocketbase.tar.gz" ]; then
  EXPECTED=$(jq -r '.files.pocketbase.sha256' "$MANIFEST")
  ACTUAL=$(sha256sum "$BACKUP_PATH/pocketbase.tar.gz" | awk '{print $1}')
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "[restore] FATAL: PocketBase checksum mismatch (expected $EXPECTED, got $ACTUAL)"
    exit 1
  fi
  echo "[restore] PocketBase checksum OK"
fi

# ── Stop services ─────────────────────────────────────────────────────────
echo "[restore] stopping services (docker compose down)"
( cd "$(dirname "$0")/../deploy" 2>/dev/null && docker compose stop pocketbase qdrant ) || true

# ── Restore PocketBase ────────────────────────────────────────────────────
if [ -f "$BACKUP_PATH/pocketbase.tar.gz" ]; then
  echo "[restore] restoring PocketBase to $PB_DATA_DIR"
  rm -rf "$PB_DATA_DIR"
  mkdir -p "$(dirname "$PB_DATA_DIR")"
  tar -xzf "$BACKUP_PATH/pocketbase.tar.gz" -C "$(dirname "$PB_DATA_DIR")"
fi

# ── Restore Qdrant ────────────────────────────────────────────────────────
if [ -f "$BACKUP_PATH/qdrant.snapshot" ]; then
  echo "[restore] restoring Qdrant snapshot"
  # Qdrant expects a snapshot uploaded to its API or placed in the snapshots dir
  cp "$BACKUP_PATH/qdrant.snapshot" "$QDRANT_DATA_DIR/snapshots/"
  SNAPSHOT_NAME=$(basename "$BACKUP_PATH/qdrant.snapshot")
  curl -sf -X PUT "$QDRANT_URL/snapshots/recover" \
    -H "Content-Type: application/json" \
    -d "{\"location\": \"file:///qdrant/snapshots/$SNAPSHOT_NAME\"}" \
    || echo "[restore] WARN: Qdrant snapshot recovery API failed"
elif [ -f "$BACKUP_PATH/qdrant.tar.gz" ]; then
  echo "[restore] restoring Qdrant from raw tarball"
  rm -rf "$QDRANT_DATA_DIR"
  mkdir -p "$(dirname "$QDRANT_DATA_DIR")"
  tar -xzf "$BACKUP_PATH/qdrant.tar.gz" -C "$(dirname "$QDRANT_DATA_DIR")"
fi

# ── Restart services ──────────────────────────────────────────────────────
echo "[restore] restarting services (docker compose up -d)"
( cd "$(dirname "$0")/../deploy" 2>/dev/null && docker compose up -d pocketbase qdrant ) || true

echo "[restore] done. Next user message will be processed normally."
