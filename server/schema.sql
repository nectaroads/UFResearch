CREATE TABLE IF NOT EXISTS accounts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  login text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  lattes text NOT NULL DEFAULT '',
  level text NOT NULL,
  matricula text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('coordinator', 'member')),
  approved boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id integer NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS topics_name_ci ON topics (lower(name));

CREATE TABLE IF NOT EXISTS publications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_id integer NOT NULL REFERENCES topics(id),
  owner_id integer NOT NULL REFERENCES accounts(id),
  title text NOT NULL,
  journal text NOT NULL,
  authors text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 1000 AND 9999),
  download_url text,
  pdf bytea,
  CHECK (num_nonnulls(download_url, pdf) = 1)
);
CREATE INDEX IF NOT EXISTS publications_topic_idx ON publications (topic_id, year DESC, id DESC);

CREATE OR REPLACE FUNCTION search_text(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT translate(lower(normalize(input)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')
$$;
