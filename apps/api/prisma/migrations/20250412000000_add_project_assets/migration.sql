-- Migration: add project-level misc assets and song shot list URL

-- 1. Add shotListUrl column to Song
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "shotListUrl" TEXT;

-- 2. Create ProjectAssetCategory enum
DO $$ BEGIN
  CREATE TYPE "ProjectAssetCategory" AS ENUM (
    'ShotList',
    'FilmingClip',
    'TrailerVersion',
    'TrailerAudio',
    'Misc'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 3. Create ProjectAsset table
CREATE TABLE IF NOT EXISTS "ProjectAsset" (
    "id"            TEXT NOT NULL,
    "projectId"     TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "type"          TEXT NOT NULL DEFAULT '',
    "category"      "ProjectAssetCategory" NOT NULL DEFAULT 'Misc',
    "fileSizeBytes" INTEGER,
    "storageKey"    TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAsset_pkey" PRIMARY KEY ("id")
);

-- 4. Add foreign key (idempotent)
DO $$ BEGIN
  ALTER TABLE "ProjectAsset"
    ADD CONSTRAINT "ProjectAsset_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 5. Index for fast lookup by project
CREATE INDEX IF NOT EXISTS "ProjectAsset_projectId_idx" ON "ProjectAsset"("projectId");
