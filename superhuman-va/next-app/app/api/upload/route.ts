// POST /api/upload — accepts a multipart file, forwards to memory-service.
import { NextRequest, NextResponse } from "next/server";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

const MEMORY_SERVICE = process.env.MEMORY_SERVICE_URL ?? "http://localhost:8000";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }

  const forward = new FormData();
  forward.set("user_id", (form.get("user_id") as string) || USER_ID);
  // Re-pack the file as a Blob; `file` is already a File, so just pass it.
  forward.set("file", file, file.name);

  const r = await fetch(`${MEMORY_SERVICE}/ingest_document`, {
    method: "POST",
    body: forward,
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json(
      { error: `memory-service ${r.status}`, detail: text },
      { status: r.status }
    );
  }
  return NextResponse.json(await r.json());
}
