-- Operational roles foundation (ADR-0084): the three post-sale roles of the client CRM
-- workflow — Logistics Manager, Logistics Executive, Accounts Executive.
--
-- Purely additive: three new enum values. No table, column or row is changed, and no
-- existing user's role moves. Postgres cannot drop an enum value, so reverting means
-- recreating the type — keep that in mind before adding more.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'LOGISTICS_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'LOGISTICS_EXECUTIVE';
ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTS_EXECUTIVE';
