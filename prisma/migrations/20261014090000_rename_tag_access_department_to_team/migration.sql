-- Tag Permissions key on a TEAM, not a department (ADR-0091, corrected). The grouping the feature uses
-- is User.team — the established grouping in the product docs and the UI ("Team" filter, "Sales Team"
-- widget); no Department entity exists. 20261013120000_add_tag_access_policies named the column
-- "department", which would mislead anyone reading the schema, so it is renamed.
--
-- Metadata only: no row is rewritten and none is lost (the table held no rows when this was applied).
-- Renaming a column rewrites the expression of any CHECK that mentions it, so
-- "tag_access_policies_one_subject_chk" now reads num_nonnulls("team", "user_id") = 1 without being touched.

-- AlterTable
ALTER TABLE "tag_access_policies" RENAME COLUMN "department" TO "team";

-- RenameIndex
ALTER INDEX "tag_access_policies_department_key" RENAME TO "tag_access_policies_team_key";

-- Keep the constraint name honest as well.
ALTER TABLE "tag_access_policies"
  RENAME CONSTRAINT "tag_access_policies_department_complete_chk" TO "tag_access_policies_team_complete_chk";
