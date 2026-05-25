-- AlterEnum: Rename 'admin' to 'leader' and add 'deputy' to ParticipantRole

-- Step 1: Add new values to the enum
ALTER TYPE "ParticipantRole" ADD VALUE IF NOT EXISTS 'leader';
ALTER TYPE "ParticipantRole" ADD VALUE IF NOT EXISTS 'deputy';

-- Step 2: Update existing 'admin' rows to 'leader'
UPDATE "participants" SET "role" = 'leader' WHERE "role" = 'admin';

-- Step 3: Remove 'admin' from the enum by recreating it
-- PostgreSQL doesn't support removing enum values, so we recreate the type
ALTER TYPE "ParticipantRole" RENAME TO "ParticipantRole_old";

CREATE TYPE "ParticipantRole" AS ENUM ('leader', 'deputy', 'member');

-- Drop the default before altering the column type (required by PostgreSQL)
ALTER TABLE "participants" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "participants"
  ALTER COLUMN "role" TYPE "ParticipantRole"
  USING ("role"::text::"ParticipantRole");

ALTER TABLE "participants"
  ALTER COLUMN "role" SET DEFAULT 'member';

DROP TYPE "ParticipantRole_old";

-- AlterTable: Add soft delete column to conversations
ALTER TABLE "conversations" ADD COLUMN "deleted_at" TIMESTAMP(3);
