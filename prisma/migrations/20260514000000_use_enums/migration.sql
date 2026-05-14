CREATE TYPE "RequestStatus" AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE "ConversationType" AS ENUM ('direct', 'group');
CREATE TYPE "ParticipantRole" AS ENUM ('admin', 'member');

ALTER TABLE "friend_requests" ALTER COLUMN "status" TYPE "RequestStatus" USING ("status"::text::"RequestStatus");
ALTER TABLE "friend_requests" ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "conversations" ALTER COLUMN "type" TYPE "ConversationType" USING ("type"::text::"ConversationType");

ALTER TABLE "participants" ALTER COLUMN "role" TYPE "ParticipantRole" USING ("role"::text::"ParticipantRole");
ALTER TABLE "participants" ALTER COLUMN "role" SET DEFAULT 'member';
