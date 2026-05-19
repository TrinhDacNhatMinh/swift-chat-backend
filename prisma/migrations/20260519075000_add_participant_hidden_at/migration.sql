-- AlterTable: Add hidden_at column to participants
-- Allows a user to hide a direct conversation from their list
-- without affecting the other participant.
ALTER TABLE "participants" ADD COLUMN "hidden_at" TIMESTAMP(3);
