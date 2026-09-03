import {
  OVERDUE_FOLLOW_UPS_SELECT,
  toOverdueFollowUpRow,
  type OverdueFollowUpRow,
} from './overdue-follow-ups-response.dto';

/**
 * Today's Follow Ups renders the same six columns as the Overdue report's detailed view — Lead
 * Name, Lead Status, Assigned User, Follow up Type, Date & Time, Notes — so it reuses that
 * report's projection and row mapper rather than keeping a second copy that could drift from it.
 * Only the bucket differs, and that lives in the `where`, not here.
 */
export {
  OVERDUE_FOLLOW_UPS_SELECT as TODAYS_FOLLOW_UPS_SELECT,
  toOverdueFollowUpRow as toTodaysFollowUpRow,
};

export type TodaysFollowUpRow = OverdueFollowUpRow;

export interface TodaysFollowUpsListResponse {
  rows: TodaysFollowUpRow[];
  total: number;
}
