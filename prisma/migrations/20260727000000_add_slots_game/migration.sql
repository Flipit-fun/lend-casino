-- AlterEnum
-- Adds the SLOTS game kind. ADD VALUE cannot run inside a transaction block,
-- so this statement stands alone in its own migration.
ALTER TYPE "GameKind" ADD VALUE 'SLOTS';
