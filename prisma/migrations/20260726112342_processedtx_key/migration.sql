/*
  Warnings:

  - The primary key for the `ProcessedTx` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `ProcessedTx` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `kind` to the `ProcessedTx` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProcessedTx" DROP CONSTRAINT "ProcessedTx_pkey",
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "kind" TEXT NOT NULL,
ADD CONSTRAINT "ProcessedTx_pkey" PRIMARY KEY ("id");
