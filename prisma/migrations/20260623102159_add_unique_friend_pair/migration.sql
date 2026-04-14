/*
  Warnings:

  - A unique constraint covering the columns `[user_id_1,user_id_2]` on the table `friends` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "friends_user_id_1_user_id_2_key" ON "friends"("user_id_1", "user_id_2");
