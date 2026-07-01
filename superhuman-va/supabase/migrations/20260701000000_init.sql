-- 0001_init.sql — initial schema for superhuman-va on Supabase.
--
-- This migration creates all 7 tables, the pgvector extension, the HNSW
-- indexes for cosine distance, and Row-Level Security policies scoped to
-- the authenticated user.
--
-- Run: `supabase db push`

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ── conversations ───────────────────────────────────────────────────────────
-- One row per chat session.
CREATE TABLE IF NOT EXISTS public.conversations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT 'New chat',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON public.conversations(updated_at DESC);

-- ── messages ────────────────────────────────────────────────────────────────
-- Append-only log of every chat turn.
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  memory_saved    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id_created ON public.messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages(conversation_id, created_at);

-- ── agent_state ─────────────────────────────────────────────────────────────
-- Per-conversation, per-agent JSON state (CoS working memory, etc).
CREATE TABLE IF NOT EXISTS public.agent_state (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  agent_name      text NOT NULL,
  state_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, agent_name)
);
CREATE INDEX IF NOT EXISTS idx_agent_state_conversation ON public.agent_state(conversation_id);

-- ── agent_messages ──────────────────────────────────────────────────────────
-- A2A consults (agent → agent). Drives the Team Panel UI.
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  turn_id         text NOT NULL,
  from_agent      text NOT NULL,
  to_agent        text NOT NULL,
  message         text NOT NULL,
  reply           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied', 'error')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON public.agent_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_turn ON public.agent_messages(turn_id);

-- ── memories ────────────────────────────────────────────────────────────────
-- Per-user facts extracted from chats (Mem0 + global). 384-dim embedding
-- (BAAI/bge-small-en-v1.5). HNSW index for cosine distance.
CREATE TABLE IF NOT EXISTS public.memories (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  fact            text NOT NULL,
  embedding       vector(384),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_global       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON public.memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_global ON public.memories(user_id, is_global);
-- HNSW index for cosine distance
CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
  ON public.memories USING hnsw (embedding vector_cosine_ops);

-- ── documents ───────────────────────────────────────────────────────────────
-- Uploaded PDFs / files, chunked, embedded.
CREATE TABLE IF NOT EXISTS public.documents (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename   text NOT NULL,
  content    text NOT NULL,
  embedding  vector(384),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_embedding_hnsw
  ON public.documents USING hnsw (embedding vector_cosine_ops);

-- ── message_index ───────────────────────────────────────────────────────────
-- Cross-conversation search of past chat messages. Replaces the Qdrant
-- `messages` collection.
CREATE TABLE IF NOT EXISTS public.message_index (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text            text NOT NULL,
  embedding       vector(384),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_index_user_id ON public.message_index(user_id);
CREATE INDEX IF NOT EXISTS idx_message_index_embedding_hnsw
  ON public.message_index USING hnsw (embedding vector_cosine_ops);

-- ── cost_traces ─────────────────────────────────────────────────────────────
-- Replaces the local SQLite `traces` table. One row per turn.
CREATE TABLE IF NOT EXISTS public.cost_traces (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  turn_id         text NOT NULL UNIQUE,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_traces_user_created ON public.cost_traces(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_traces_conversation ON public.cost_traces(conversation_id);

-- ── Row-Level Security ──────────────────────────────────────────────────────

-- Helper: set up RLS on a table with a `user_id` column.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'conversations',
    'memories',
    'documents',
    'message_index',
    'cost_traces'
  ];
BEGIN
  FOR t IN SELECT unnest(tables) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "own data" ON public.%I;', t);
    EXECUTE format($p$
      CREATE POLICY "own data" ON public.%I
        FOR ALL
        USING (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    $p$, t);
  END LOOP;
END$$;

-- messages: scoped via conversation_id (which is owned by user_id)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own data" ON public.messages;
CREATE POLICY "own data" ON public.messages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- agent_state: scoped via conversation_id join
ALTER TABLE public.agent_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own data" ON public.agent_state;
CREATE POLICY "own data" ON public.agent_state
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = agent_state.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = agent_state.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- agent_messages: same join
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own data" ON public.agent_messages;
CREATE POLICY "own data" ON public.agent_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = agent_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- ── updated_at trigger for conversations ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON public.conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_agent_state_updated_at ON public.agent_state;
CREATE TRIGGER trg_agent_state_updated_at
  BEFORE UPDATE ON public.agent_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
