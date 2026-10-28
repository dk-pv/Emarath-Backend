import { registerAs } from '@nestjs/config';
import { resolveCorsOrigins, resolveEnvironment } from './configuration';

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
 * the reset link points at; when Resend sends from a hosted deploy it must be a real one (C3).
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

/** Hosts that name the server itself, never a link a recipient can open. */
const LOOPBACK =
  /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\])$/i;

/**
 * `WEB_APP_URL` when Resend mails reset links from a hosted deploy (C3): the frontend's https
 * origin and nothing after it, since the link appends `/reset-password`, and one of the CORS
 * origins, since the reset page posts the new password from there and the Origin check refuses
 * every other site. Unset, the links would point at localhost. The error never repeats the value.
 */
function hostedWebAppUrl(raw: string | undefined): string {
  let url: URL | null = null;
  try {
    url = new URL(raw?.trim() ?? '');
  } catch {
    url = null;
  }
  const problem = !raw?.trim()
    ? 'is not set'
    : !url
      ? 'is not a valid URL'
      : url.protocol !== 'https:'
        ? 'must use https'
        : LOOPBACK.test(url.hostname)
          ? 'points at this machine'
          : url.username ||
              url.password ||
              url.pathname !== '/' ||
              url.search ||
              url.hash
            ? 'must be an origin only, such as https://app.example.com'
            : !resolveCorsOrigins().includes(url.origin)
              ? 'is not one of the CORS_ORIGIN origins (each written as the browser sends it: lowercase, no trailing slash)'
              : null;
  if (problem || !url) {
    throw new Error(
      `WEB_APP_URL ${problem}. With MAIL_PROVIDER "resend" outside development it must be the frontend's public https origin, listed in CORS_ORIGIN: password-reset emails link to it.`,
    );
  }
  return url.origin;
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
    webAppUrl:
      provider === 'resend' && !isDevelopment
        ? hostedWebAppUrl(process.env.WEB_APP_URL)
        : (process.env.WEB_APP_URL ?? 'http://localhost:3000'),
  };
});
