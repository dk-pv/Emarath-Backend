import {
  OVERDUE_FOLLOW_UPS_SELECT,
  toOverdueFollowUpRow,
  type OverdueFollowUpRow,
} from './overdue-follow-ups-response.dto';

/**
 * Upcoming Follow Ups renders the same six columns as its two sibling reports — Lead Name, Lead
 * Status, Assigned User, Follow up Type, Date & Time, Notes — so it reuses the Overdue report's
 * projection and row mapper rather than keeping a third copy that could drift from them. Only
 * the predicate differs, and that lives in the `where`.
 */
export {
  OVERDUE_FOLLOW_UPS_SELECT as UPCOMING_FOLLOW_UPS_SELECT,
  toOverdueFollowUpRow as toUpcomingFollowUpRow,
};

export type UpcomingFollowUpRow = OverdueFollowUpRow;

export interface UpcomingFollowUpsListResponse {
  rows: UpcomingFollowUpRow[];
  total: number;
}
