-- Migration 001: Add tsvector columns and GIN indexes for universal search
-- Run with: psql $DATABASE_URL -f 001-add-search-vectors.sql

-- Contacts search vector
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(email, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(suburb, '') || ' ' || coalesce(phone, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS contacts_search_idx ON contacts USING GIN (search_vector);

-- Organisations search vector
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(abn, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(suburb, '') || ' ' || coalesce(website, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS organisations_search_idx ON organisations USING GIN (search_vector);

-- Donations search vector
ALTER TABLE donations ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(reference, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(campaign, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(notes, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS donations_search_idx ON donations USING GIN (search_vector);
