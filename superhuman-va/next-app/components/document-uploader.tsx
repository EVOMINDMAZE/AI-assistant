"use client";

import { useState, useCallback, useRef } from "react";
import { Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface UploadedDoc {
  filename: string;
  doc_id: string;
  chunks: number;
}

export function DocumentUploader() {
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<UploadedDoc[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: form });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setRecent((prev) =>
        [{ filename: file.name, doc_id: data.doc_id, chunks: data.chunks_created }, ...prev].slice(0, 5)
      );
      toast.success(
        `Indexed ${file.name} (${data.chunks_created} chunks, ${data.chars_extracted} chars)`
      );
    } catch (err) {
      console.error(err);
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm transition-colors ${
          dragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <p className="text-muted-foreground">
          {busy ? "Uploading ..." : "Drop a PDF or text file, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">Max 10MB · PDF, txt, md, csv</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.log,.markdown"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {recent.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Recently uploaded</p>
          {recent.map((d) => (
            <div
              key={d.doc_id}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{d.filename}</span>
              <span className="text-muted-foreground">{d.chunks} chunks</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
