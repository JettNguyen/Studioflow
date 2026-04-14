-- Add versioning columns to ProjectAsset
ALTER TABLE "ProjectAsset" ADD COLUMN IF NOT EXISTS "versionGroup"  TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "ProjectAsset" ADD COLUMN IF NOT EXISTS "versionNumber" INTEGER NOT NULL DEFAULT 1;

-- Back-fill existing rows: use a slug derived from the asset name
-- (lowercase, spaces→dashes, strip non-alphanumeric).  Version number stays 1.
UPDATE "ProjectAsset"
SET "versionGroup" = regexp_replace(
      lower(trim(name)),
      '[^a-z0-9]+', '-', 'g'
    )
WHERE "versionGroup" = 'legacy';

CREATE INDEX IF NOT EXISTS "ProjectAsset_projectId_versionGroup_versionNumber_idx"
  ON "ProjectAsset" ("projectId", "versionGroup", "versionNumber");
