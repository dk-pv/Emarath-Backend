import { Prisma } from '../generated/prisma/client';

/**
 * A team's leads (Teams v1): the leads with at least one current assignee carrying the team's
 * label — or, for `null`, at least one assignee with no team. Counting a team through this
 * predicate counts each lead once however many of the team's members share it; a lead
 * co-assigned across two teams belongs to both. Membership is the assignee's team today, so a
 * lead follows its owner when they move teams.
 */
export function teamLeadsWhere(team: string | null): Prisma.LeadWhereInput {
  return { assignments: { some: { user: { team } } } };
}

/**
 * A won value as a percentage of a monthly goal, rounded to two places and uncapped (the
 * dashboard's rule); null when there is no positive goal, so the screen says "No Target Set". The
 * goal is monthly and is not pro-rated to the report's window.
 */
export function achievementPercent(
  won: Prisma.Decimal,
  goal: Prisma.Decimal | null | undefined,
): number | null {
  return goal && goal.gt(0)
    ? Math.round(won.div(goal).toNumber() * 10000) / 100
    : null;
}
