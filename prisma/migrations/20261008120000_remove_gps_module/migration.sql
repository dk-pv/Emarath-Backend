-- Remove the GPS/Map module (ADR-0086): field check-ins, passive location points, the
-- site catalogue, the location-verified completion gate's activity link and the team
-- member wizard's two tracking toggles.
--
-- DESTRUCTIVE: CLAUDE.md §11 requires explicit human approval before this is applied.
-- It permanently destroys:
--   check_ins                      every field visit: check-in/out times, coordinates and
--                                  the follow-up it verified
--   location_points                every passive tracking ping
--   locations                      the site catalogue: name, coordinates, radius
--   activities.location_id         a follow-up's site link; the follow-up row itself stays
--   users.track_check_in_out       the wizard's "Track the check in and check out" toggle
--   users.track_meeting_location   the wizard's "Track the location of Meetings" toggle
--   user_module_permissions rows for module GPS_MAP (the GPS/Map view grants)
-- No lead, activity, user, call or document row is deleted. Not reversible: a revert can
-- recreate the tables and columns empty, never their data.

-- GPS_MAP has left the permission catalogue, so a stored row would fail the DTO's module
-- check the next time the wizard saves that member.
DELETE FROM "user_module_permissions" WHERE "module" = 'GPS_MAP';

-- DropForeignKey: the only FK from a surviving table into a GPS table; it must go before
-- "locations" can be dropped.
ALTER TABLE "activities" DROP CONSTRAINT "activities_location_id_fkey";

-- DropForeignKey
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_activity_id_fkey";

-- DropForeignKey
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "location_points" DROP CONSTRAINT "location_points_agent_id_fkey";

-- AlterTable
ALTER TABLE "activities" DROP COLUMN "location_id";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "track_check_in_out",
DROP COLUMN "track_meeting_location";

-- DropTable
DROP TABLE "check_ins";

-- DropTable
DROP TABLE "location_points";

-- DropTable
DROP TABLE "locations";
