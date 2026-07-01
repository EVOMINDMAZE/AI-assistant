// lib/embedding.ts — 384-dim embeddings using @xenova/transformers.
//
// We use BAAI/bge-small-en-v1.5 (384-dim, ~33M params, MIT license) which
// is small enough to cold-start inside a Vercel serverless function (≈
// 100-300 MB) and high-quality enough for short personal-assistant text.
//
// The pipeline is memoized at module scope so subsequent calls are fast.

import "server-only";
import type { FeatureExtractionPipeline } from "@xenova/transformers";

let _pipeline: FeatureExtractionPipeline | null = null;
let _loadPromise: Promise<FeatureExtractionPipeline> | null = null;

const MODEL_ID = "Xenova/bge-small-en-v1.5";

/** Lazily load the embedding pipeline. Cached for the lifetime of the
 *  serverless instance. */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const t = await import("@xenova/transformers");
    // Optional: pin a cache dir to /tmp so it survives cold starts in
    // serverless. Default in @xenova/transformers is /cache.
    t.env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR || "/tmp/transformers-cache";
    _pipeline = await t.pipeline("feature-extraction", MODEL_ID) as FeatureExtractionPipeline;
    return _pipeline;
  })();
  return _loadPromise;
}

/** Compute a 384-dim embedding for a single string. */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  // out is a Tensor; convert to a plain number[]
  const data: Float32Array = (out as any).data ?? out;
  return Array.from(data);
}

/** Compute embeddings for an array of strings in one call. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await getEmbeddingPipeline();
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  // out.data is a flat Float32Array; each 384 floats is one row.
  const flat: Float32Array = (out as any).data ?? out;
  const rows: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    rows.push(Array.from(flat.slice(i * 384, (i + 1) * 384)));
  }
  return rows;
}
