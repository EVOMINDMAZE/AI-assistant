"""Bootstrap the PocketBase schema for the Superhuman VA.

Run once after `docker compose up -d` brings PocketBase healthy. Idempotent:
re-running won't duplicate collections.

Usage (from inside the memory-service container, or anywhere with network
access to PocketBase):

    python scripts/pb_bootstrap.py

Reads PB_* env vars. Will create the admin superuser if one doesn't exist
(PocketBase v0.22+ requires this for first-run setup).
"""

from __future__ import annotations

import os
import sys
import time

import httpx

PB_URL = os.getenv("POCKETBASE_URL", "http://pocketbase:8090")
ADMIN_EMAIL = os.getenv("POCKETBASE_ADMIN_EMAIL") or os.getenv("PB_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.getenv("POCKETBASE_ADMIN_PASSWORD") or os.getenv("PB_ADMIN_PASSWORD", "")


def wait_for_pocketbase(timeout: int = 60) -> None:
    """Block until /api/health returns 200, or raise."""
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{PB_URL}/api/health", timeout=5)
            if r.status_code == 200:
                print(f"[pb] healthy at {PB_URL}")
                return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
        time.sleep(2)
    raise RuntimeError(f"PocketBase did not become healthy in {timeout}s: {last_err}")


def ensure_admin(client: httpx.Client) -> str:
    """Make sure we have a valid admin token. Returns the token."""
    r = client.post(
        f"{PB_URL}/api/admins/auth-with-password",
        json={"identity": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if r.status_code == 200:
        return r.json()["token"]

    # No admin yet — try to create one (works only on a fresh PB install
    # where the installer link hasn't been consumed).
    print("[pb] no admin found, attempting first-run install ...")
    r = client.post(
        f"{PB_URL}/api/admins",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "passwordConfirm": ADMIN_PASSWORD},
    )
    if r.status_code not in (200, 201):
        print(f"[pb] could not create admin ({r.status_code}): {r.text}")
        sys.exit(1)
    # Now log in
    r = client.post(
        f"{PB_URL}/api/admins/auth-with-password",
        json={"identity": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    r.raise_for_status()
    return r.json()["token"]


def list_collections(client: httpx.Client, token: str) -> list[dict]:
    r = client.get(
        f"{PB_URL}/api/collections",
        headers={"Authorization": token},
    )
    r.raise_for_status()
    return r.json().get("items", [])


def create_collection(
    client: httpx.Client, token: str, body: dict
) -> dict:
    r = client.post(
        f"{PB_URL}/api/collections",
        json=body,
        headers={"Authorization": token},
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"create collection failed ({r.status_code}): {r.text}")
    return r.json()


CONVERSATIONS_SCHEMA = {
    "name": "conversations",
    "type": "base",
    "schema": [
        {"name": "user_id", "type": "text", "required": True, "options": {"min": 1, "max": 200}},
        {"name": "title", "type": "text", "required": True, "options": {"min": 1, "max": 200}},
    ],
    "indexes": [
        "CREATE INDEX idx_conv_user ON conversations (user_id)",
    ],
    "listRule": "",
    "viewRule": "",
    "createRule": "",
    "updateRule": "",
    "deleteRule": "",
}

MESSAGES_SCHEMA = {
    "name": "messages",
    "type": "base",
    "schema": [
        {
            "name": "conversation_id",
            "type": "relation",
            "required": True,
            "options": {
                "collectionId": "__CONVERSATIONS_ID__",  # filled at runtime
                "cascadeDelete": True,
                "maxSelect": 1,
            },
        },
        {
            "name": "role",
            "type": "select",
            "required": True,
            "options": {
                "maxSelect": 1,
                "values": ["user", "assistant", "system"],
            },
        },
        {"name": "content", "type": "text", "required": True, "options": {"max": 200000}},
        {"name": "memory_saved", "type": "bool", "required": False, "options": {}},
    ],
    "indexes": [
        "CREATE INDEX idx_msg_conv ON messages (conversation_id)",
    ],
    "listRule": "",
    "viewRule": "",
    "createRule": "",
    "updateRule": "",
    "deleteRule": "",
}


def main() -> None:
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        print("Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD first.")
        sys.exit(1)

    print(f"[pb] waiting for PocketBase at {PB_URL} ...")
    wait_for_pocketbase()

    with httpx.Client(timeout=30) as client:
        token = ensure_admin(client)
        print("[pb] authenticated as admin.")

        existing = {c["name"]: c for c in list_collections(client, token)}

        if "conversations" in existing:
            print("[pb] conversations already exists, skipping.")
            conv_id = existing["conversations"]["id"]
        else:
            conv = create_collection(client, token, CONVERSATIONS_SCHEMA)
            conv_id = conv["id"]
            print(f"[pb] created conversations ({conv_id}).")

        if "messages" in existing:
            print("[pb] messages already exists, skipping.")
        else:
            body = MESSAGES_SCHEMA.copy()
            body["schema"] = [
                {**f, "options": {**f["options"], "collectionId": conv_id}}
                if f["name"] == "conversation_id"
                else f
                for f in body["schema"]
            ]
            create_collection(client, token, body)
            print("[pb] created messages.")

    print("[pb] done.")


if __name__ == "__main__":
    main()
