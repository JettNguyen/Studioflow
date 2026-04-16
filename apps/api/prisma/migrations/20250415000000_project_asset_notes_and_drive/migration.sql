-- Add driveFileId column to ProjectAsset
ALTER TABLE "ProjectAsset" ADD COLUMN IF NOT EXISTS "driveFileId" TEXT;

-- Create ProjectAssetNote table
CREATE TABLE IF NOT EXISTS "ProjectAssetNote" (
  "id"        TEXT         NOT NULL,
  "assetId"   TEXT         NOT NULL,
  "authorId"  TEXT         NOT NULL,
  "body"      TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectAssetNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectAssetNote_assetId_fkey"  FOREIGN KEY ("assetId")  REFERENCES "ProjectAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectAssetNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id")         ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProjectAssetNote_assetId_idx" ON "ProjectAssetNote"("assetId");
