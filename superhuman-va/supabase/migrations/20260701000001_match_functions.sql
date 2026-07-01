-- 0002_match_functions.sql — pgvector similarity search helpers.
--
-- These are the SQL functions the Next.js pgvector helper
-- (lib/supabase/vector.ts) calls via `.rpc()`. Each takes a query
-- embedding, a user_id, and a match count, and returns rows ordered by
-- cosine distance ASC (smaller = more similar).

-- ── match_memories ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(384),
  p_user_id       uuid,
  match_count     int DEFAULT 5,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id        uuid,
  fact      text,
  score     float,
  metadata  jsonb,
  is_global boolean
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id,
    m.fact,
    (m.embedding <=> query_embedding)::float AS score,
    m.metadata,
    m.is_global
  FROM public.memories m
  WHERE m.user_id = p_user_id
    AND (m.embedding <=> query_embedding) < match_threshold
  ORDER BY m.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ── match_documents ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector(384),
  p_user_id       uuid,
  match_count     int DEFAULT 3,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id       uuid,
  filename text,
  content  text,
  score    float,
  metadata jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT
    d.id,
    d.filename,
    d.content,
    (d.embedding <=> query_embedding)::float AS score,
    d.metadata
  FROM public.documents d
  WHERE d.user_id = p_user_id
    AND (d.embedding <=> query_embedding) < match_threshold
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- ── match_message_index ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_message_index(
  query_embedding vector(384),
  p_user_id       uuid,
  match_count     int DEFAULT 5,
  match_threshold float DEFAULT 0.5
)
RETURNS TABLE (
  id              uuid,
  conversation_id uuid,
  message_id      uuid,
  role            text,
  text            text,
  score           float
)
LANGUAGE sql STABLE AS $$
  SELECT
    mi.id,
    mi.conversation_id,
    mi.message_id,
    mi.role,
    mi.text,
    (mi.embedding <=> query_embedding)::float AS score
  FROM public.message_index mi
  WHERE mi.user_id = p_user_id
    AND (mi.embedding <=> query_embedding) < match_threshold
  ORDER BY mi.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.match_memories TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_documents TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_message_index TO authenticated;
