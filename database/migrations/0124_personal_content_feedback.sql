-- One current preference label per article for the site's single reader.
CREATE TABLE personal_content_feedback (
  article_id     text PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('more', 'irrelevant', 'marketing', 'duplicate')),
  page_url       text,
  title          text NOT NULL,
  summary        text,
  source_name    text NOT NULL,
  author         text,
  category       text,
  tags           text[] NOT NULL DEFAULT '{}',
  channel        text NOT NULL CHECK (channel IN ('news', 'x')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
