import { registerAs } from '@nestjs/config';
import { resolveEnvironment } from './configuration';

/**
 * Mail configuration (AUTH-03.1, ADR-0031). Its own `mail` namespace, consumed via
 * `ConfigService.get<MailConfig>('mail')` so application code never reads `process.env`
 * directly (CLAUDE §5).
 *
 * Email is optional. Development (and the test suite) uses the log transport so a reset link
 * needs no network, credentials or verified domain. Outside development no provider is
 * configured until MAIL_PROVIDER names one: the `disabled` transport sends nothing and the
 * email actions refuse with a clear 503, so the server starts without Resend. When `resend` is
 * selected its API key and from-address are required and the app refuses to boot without them,
 * as the JWT secret fails closed. The log transport writes each reset link, token included, to
 * the log, so it is refused outside development (ADR-0095). `webAppUrl` is the frontend origin
 * the reset link points at.
 */
export type MailProvider = 'disabled' | 'log' | 'resend';

export interface MailConfig {
  provider: MailProvider;
  /** Resend API key — required when provider is `resend`. */
  resendApiKey: string | null;
  /** From address on outgoing mail (e.g. `no-reply@<verified-domain>`). */
  from: string;
  /** Frontend origin used to build the reset link (`<webAppUrl>/reset-password?token=…`). */
  webAppUrl: string;
}

export default registerAs('mail', (): MailConfig => {
  const isDevelopment = resolveEnvironment() === 'development';

  // Unset (or blank) means the log transport in development and no transport elsewhere, so a
  // hosted deploy starts without Resend. A dev box may set MAIL_PROVIDER=resend to smoke-test
  // real delivery; `log` never leaves development.
  const rawProvider =
    process.env.MAIL_PROVIDER?.trim().toLowerCase() ||
    (isDevelopment ? 'log' : 'disabled');
  if (
    rawProvider !== 'disabled' &&
    rawProvider !== 'log' &&
    rawProvider !== 'resend'
  ) {
    throw new Error(`Invalid MAIL_PROVIDER "${rawProvider}".`);
  }
  if (rawProvider === 'log' && !isDevelopment) {
    throw new Error(
      'MAIL_PROVIDER "log" is only allowed in development: it writes password-reset links to the log. Outside development use "resend" with RESEND_API_KEY and MAIL_FROM.',
    );
  }
  const provider: MailProvider = rawProvider;

  const resendApiKey = process.env.RESEND_API_KEY ?? null;
  const from = process.env.MAIL_FROM ?? 'Emarath <no-reply@emarath.local>';

  if (provider === 'resend' && (!resendApiKey || !process.env.MAIL_FROM)) {
    throw new Error(
      'RESEND_API_KEY and MAIL_FROM must be set when MAIL_PROVIDER is "resend".',
    );
  }

  return {
    provider,
    resendApiKey,
    from,
    webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  };
});
