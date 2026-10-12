-- Pre-apply on a prod copy before deploying the assistant transports build.
-- Mirrors what `prisma db push` will do at startup; additive, no data loss.
ALTER TABLE "TelegramAssistantLink"
  ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'telegram';
DROP INDEX IF EXISTS "TelegramAssistantLink_telegramUserId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramAssistantLink_transport_telegramUserId_key"
  ON "TelegramAssistantLink" ("transport", "telegramUserId");
