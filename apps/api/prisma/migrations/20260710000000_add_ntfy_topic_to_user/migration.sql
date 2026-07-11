-- Shared team ntfy topic, stored on the project owner's account.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ntfyTopic" TEXT;
