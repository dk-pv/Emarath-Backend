import { IsBoolean } from 'class-validator';

/** The `app_settings` row this screen owns. */
export const COMMUNICATION_ALERTS_KEY = 'communication.alerts';

export interface CommunicationAlertsSettings {
  alertsEnabled: boolean;
}

/** The reference's switch is drawn grey and off. */
export const COMMUNICATION_ALERTS_DEFAULTS: CommunicationAlertsSettings = {
  alertsEnabled: false,
};

/**
 * Settings → Communication → Emarath Alerts.
 *
 * One switch, so one field. It is a stored preference and nothing more today: the System
 * Alerts service (FND-05.1) that would *produce* alerts does not exist in this codebase —
 * no alert model, no producer, no delivery — and inventing one to give the switch
 * something to turn on was out of scope (ADR-0068).
 */
export class UpdateCommunicationAlertsDto {
  @IsBoolean()
  alertsEnabled!: boolean;
}
