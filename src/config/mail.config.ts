import { registerAs } from '@nestjs/config';

/**
 * Mail configuration (AUTH-03.1, ADR-0031). Its own `mail` namespace, consumed via
 * `ConfigService.get<MailConfig>('mail')` so application code never reads `process.env`
 * directly (CLAUDE §5).
 *
 * The provider is chosen by environment: development (and the test suite) uses the log
 * transport so a reset link needs no network, credentials or verified domain; staging and
 * production use Resend. When Resend is selected the API key and from-address are required
 * and the app refuses to boot without them — mirroring how the JWT secret fails closed in
 * production. `webAppUrl` is the frontend origin the reset link points at.
 */
export type MailProvider = 'log' | 'resend';

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
  const rawEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  const isDevelopment = rawEnv === 'development' || rawEnv === 'test';

  // Log transport in development/test; Resend everywhere else. An explicit MAIL_PROVIDER
  // overrides, so staging can force `log` (or a dev box can smoke-test `resend`).
  const rawProvider =
    process.env.MAIL_PROVIDER?.toLowerCase() ??
    (isDevelopment ? 'log' : 'resend');
  if (rawProvider !== 'log' && rawProvider !== 'resend') {
    throw new Error(`Invalid MAIL_PROVIDER "${rawProvider}".`);
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
