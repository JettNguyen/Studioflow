-- Add released column to Project
ALTER TABLE "Project" ADD COLUMN "released" BOOLEAN NOT NULL DEFAULT false;

-- Add released column to Song
ALTER TABLE "Song" ADD COLUMN "released" BOOLEAN NOT NULL DEFAULT false;
