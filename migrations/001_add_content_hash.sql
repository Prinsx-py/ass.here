-- Add content_hash column to ass_tracks to support exact deduplication
ALTER TABLE IF EXISTS ass_tracks
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Add index to make lookups by content_hash fast. Do not make unique here
-- in case existing duplicates exist; review before making unique.
CREATE INDEX IF NOT EXISTS idx_ass_tracks_content_hash ON ass_tracks(content_hash);
