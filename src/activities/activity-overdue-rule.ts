import { SettingsService } from '../settings/settings.service';
import { type OverdueRule } from './activity-buckets';

/**
 * "Make Appointment as Overdue" (Settings → Activity and Reminders), read as a
 * rule the bucket predicate can apply.
 *
 * Shared by the Activities worklist and the Dashboard's Activities tracker, so the
 * two surfaces cannot disagree about the instant an appointment turns overdue — a
 * second copy of this read is how the tab badge and the Dashboard card drift apart.
 *
 * A settings row that cannot be read must not take either surface down, so a
 * failure falls back to the shipped end-of-day rule rather than propagating.
 */
export async function resolveOverdueRule(
  settings: SettingsService,
): Promise<OverdueRule> {
  try {
    const general = await settings.getActivityGeneral();
    return {
      mode: general.overdueMode,
      minutes: general.overdueAfterMinutes,
      now: new Date(),
    };
  } catch {
    return { mode: 'END_OF_DAY', minutes: 0, now: new Date() };
  }
}
