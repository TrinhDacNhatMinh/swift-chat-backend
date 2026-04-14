-- AlterTable
ALTER TABLE "friend_requests" ADD COLUMN     "expired_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "friend_requests_status_expired_at_idx" ON "friend_requests"("status", "expired_at");
