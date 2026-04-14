-- Migration: convert ProjectAssetCategory from enum to plain TEXT
-- This allows arbitrary user-defined folder names on project assets.

-- 1. Add a temporary text column
ALTER TABLE "ProjectAsset" ADD COLUMN "categoryText" TEXT;

-- 2. Convert existing enum values to their display-name equivalents
UPDATE "ProjectAsset" SET "categoryText" = CASE category::text
  WHEN 'ShotList'       THEN 'Shot List'
  WHEN 'FilmingClip'    THEN 'Filming Clip'
  WHEN 'TrailerVersion' THEN 'Trailer Version'
  WHEN 'TrailerAudio'   THEN 'Trailer Audio'
  ELSE 'Other'
END;

-- 3. Drop the old enum column
ALTER TABLE "ProjectAsset" DROP COLUMN "category";

-- 4. Rename the text column into place and apply constraints
ALTER TABLE "ProjectAsset" RENAME COLUMN "categoryText" TO "category";
ALTER TABLE "ProjectAsset" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "ProjectAsset" ALTER COLUMN "category" SET DEFAULT 'Other';

-- 5. Drop the enum type (no longer referenced)
DROP TYPE IF EXISTS "ProjectAssetCategory";
