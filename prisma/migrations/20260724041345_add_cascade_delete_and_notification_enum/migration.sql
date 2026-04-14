/*
  Warnings:

  - You are about to drop the column `user_id` on the `device_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `email_verification_otps` table. All the data in the column will be lost.
  - You are about to drop the column `user_id_1` on the `friends` table. All the data in the column will be lost.
  - You are about to drop the column `user_id_2` on the `friends` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `participants` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `password_reset_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[account_id]` on the table `email_verification_otps` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[account_id_1,account_id_2]` on the table `friends` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[conversation_id,account_id]` on the table `participants` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `account_id` to the `device_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id` to the `email_verification_otps` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id_1` to the `friends` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id_2` to the `friends` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id` to the `notifications` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `notifications` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `account_id` to the `participants` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id` to the `password_reset_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `account_id` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('friend_request_received', 'friend_request_accepted', 'added_to_group', 'removed_from_group', 'group_role_changed', 'new_message');

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_blocked_id_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT "blocks_blocker_id_fkey";

-- DropForeignKey
ALTER TABLE "device_tokens" DROP CONSTRAINT "device_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "email_verification_otps" DROP CONSTRAINT "email_verification_otps_user_id_fkey";

-- DropForeignKey
ALTER TABLE "friend_requests" DROP CONSTRAINT "friend_requests_receiver_id_fkey";

-- DropForeignKey
ALTER TABLE "friend_requests" DROP CONSTRAINT "friend_requests_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "friends" DROP CONSTRAINT "friends_user_id_1_fkey";

-- DropForeignKey
ALTER TABLE "friends" DROP CONSTRAINT "friends_user_id_2_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "participants" DROP CONSTRAINT "participants_user_id_fkey";

-- DropForeignKey
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- DropIndex
DROP INDEX "device_tokens_user_id_idx";

-- DropIndex
DROP INDEX "email_verification_otps_user_id_idx";

-- DropIndex
DROP INDEX "friends_user_id_1_idx";

-- DropIndex
DROP INDEX "friends_user_id_1_user_id_2_key";

-- DropIndex
DROP INDEX "friends_user_id_2_idx";

-- DropIndex
DROP INDEX "notifications_user_id_is_read_idx";

-- DropIndex
DROP INDEX "participants_conversation_id_user_id_key";

-- DropIndex
DROP INDEX "participants_user_id_idx";

-- DropIndex
DROP INDEX "password_reset_tokens_user_id_idx";

-- DropIndex
DROP INDEX "refresh_tokens_user_id_idx";

-- AlterTable
ALTER TABLE "device_tokens" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "email_verification_otps" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "friends" DROP COLUMN "user_id_1",
DROP COLUMN "user_id_2",
ADD COLUMN     "account_id_1" UUID NOT NULL,
ADD COLUMN     "account_id_2" UUID NOT NULL;

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" "NotificationType" NOT NULL;

-- AlterTable
ALTER TABLE "participants" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "password_reset_tokens" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "user_id",
ADD COLUMN     "account_id" UUID NOT NULL;

-- DropTable
DROP TABLE "users";

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255),
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "handle" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100),
    "avatar_url" TEXT,
    "cover_url" TEXT,
    "bio" VARCHAR(150),
    "website" VARCHAR(255),
    "location" VARCHAR(100),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_providers" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_user_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_username_key" ON "accounts"("username");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_account_id_key" ON "profiles"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_handle_key" ON "profiles"("handle");

-- CreateIndex
CREATE INDEX "auth_providers_account_id_idx" ON "auth_providers"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_providers_provider_provider_user_id_key" ON "auth_providers"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "device_tokens_account_id_idx" ON "device_tokens"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_otps_account_id_key" ON "email_verification_otps"("account_id");

-- CreateIndex
CREATE INDEX "friends_account_id_1_idx" ON "friends"("account_id_1");

-- CreateIndex
CREATE INDEX "friends_account_id_2_idx" ON "friends"("account_id_2");

-- CreateIndex
CREATE UNIQUE INDEX "friends_account_id_1_account_id_2_key" ON "friends"("account_id_1", "account_id_2");

-- CreateIndex
CREATE INDEX "notifications_account_id_is_read_idx" ON "notifications"("account_id", "is_read");

-- CreateIndex
CREATE INDEX "participants_account_id_idx" ON "participants"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_conversation_id_account_id_key" ON "participants"("conversation_id", "account_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_account_id_idx" ON "password_reset_tokens"("account_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_account_id_idx" ON "refresh_tokens"("account_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_account_id_1_fkey" FOREIGN KEY ("account_id_1") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_account_id_2_fkey" FOREIGN KEY ("account_id_2") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_otps" ADD CONSTRAINT "email_verification_otps_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
