// POST /api/documents/upload — multipart file upload → ingest into documents table.
import { NextRequest, NextResponse } from "next/server";
import { memoryClient } from "@/lib/memory-client";
import { USER_ID } from "@/lib/deepseek";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/pdf",
  "application/json",
  "application/octet-stream",
]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported mime type: ${file.type}` }, { status: 415 });
  }
  const userId = (form.get("user_id") as string) || USER_ID;
  let content = "";
  if (file.type === "application/pdf") {
    content = `[PDF binary omitted: ${file.name}, ${file.size} bytes]`;
  } else {
    content = await file.text();
  }
  try {
    const res = await memoryClient.addDocument(userId, file.name, content, {
      mime: file.type,
      size: file.size,
    });
    return NextResponse.json({ id: res.id, filename: file.name, bytes: file.size });
  } catch (err) {
    return NextResponse.json({ error: "ingest failed", detail: String(err) }, { status: 500 });
  }
}
