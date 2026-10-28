import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend, type CreateEmailOptions } from 'resend';
import type { MailConfig } from '../config/mail.config';

/**
 * How long one send may wait on Resend. Unbounded, a hung provider holds the request open until
 * the HTTP client gives up minutes later, and the Lead Email composer spins the whole time.
 */
const SEND_TIMEOUT_MS = 15_000;

/** Shown when a send is asked for while no email provider is configured. */
export const EMAIL_DISABLED_MESSAGE =
  'Email is not set up on this server, so this action is unavailable.';

/** Shown in place of a reset-link request, which cannot be delivered while email is off. */
export const PASSWORD_RESET_DISABLED_MESSAGE =
  'Password reset by email is not set up on this server. Ask an administrator to reset your password.';

/** A password-reset email to send (AUTH-03.1). */
export interface PasswordResetEmail {
  to: string;
  /** The full reset link the recipient clicks (`<webAppUrl>/reset-password?token=…`). */
  resetUrl: string;
}

/**
 * A free-form outbound email (ADR-0032) — the Lead Email composer's payload. `from`
 * is NOT here: it is always the transport's configured, provider-verified sender
 * (`MAIL_FROM`), never caller-supplied, so a client cannot spoof the From header.
 */
export interface OutboundEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
}

/**
 * Outbound mail port (AUTH-03.1 / ADR-0032). An abstract class so it can be a Nest
 * injection token: callers depend on this type and `createMailer` binds the adapter the
 * config names. `sendPasswordReset` is the auth link; `sendMail` is the general composer
 * send the Lead Email action (ADR-0032) reuses rather than standing up a second transport.
 * Callers check `enabled` before offering an email action.
 */
export abstract class MailerService {
  abstract readonly enabled: boolean;
  abstract sendPasswordReset(email: PasswordResetEmail): Promise<void>;
  abstract sendMail(email: OutboundEmail): Promise<void>;
}

/**
 * Development/test transport: logs the reset link instead of sending it, so recovery is
 * fully testable with no network, credentials or verified domain. The link is a
 * short-lived, single-use secret — acceptable in a dev log, exactly as the dev-insecure
 * JWT secret is acceptable only outside production.
 */
@Injectable()
export class LogMailerService extends MailerService {
  readonly enabled = true;
  private readonly logger = new Logger('MailerService');

  sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    this.logger.log(`Password reset link for ${email.to}: ${email.resetUrl}`);
    return Promise.resolve();
  }

  sendMail(email: OutboundEmail): Promise<void> {
    // Dev/test: log instead of sending, so the composer is fully testable with no
    // network, credentials or verified domain. The body is user-typed, not a secret.
    this.logger.log(
      `Email to ${email.to.join(', ')}` +
        (email.cc?.length ? ` cc ${email.cc.join(', ')}` : '') +
        (email.bcc?.length ? ` bcc ${email.bcc.join(', ')}` : '') +
        ` — subject "${email.subject}"`,
    );
    return Promise.resolve();
  }
}

/**
 * Resend transport (ADR-0031), selected by `MAIL_PROVIDER=resend`. Uses the HTTP API (port
 * 443 only — no SMTP egress concerns on Render). The from-address and API key come from the
 * `mail` config, which requires them when this adapter is selected.
 */
@Injectable()
export class ResendMailerService extends MailerService {
  readonly enabled = true;
  private readonly logger = new Logger('MailerService');
  private readonly resend: Resend;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    const mail = config.getOrThrow<MailConfig>('mail');
    // The mail config guarantees these are present when provider is `resend`.
    this.resend = new Resend(mail.resendApiKey ?? undefined);
    this.from = mail.from;
  }

  /**
   * One send, bounded by SEND_TIMEOUT_MS. A timeout reads as the provider's own error, so each
   * caller logs and reports it exactly as it does a refusal. The SDK takes no abort signal, so a
   * request that times out is not cancelled and a late acceptance can still deliver.
   */
  private async send(
    payload: CreateEmailOptions,
  ): Promise<{ error: { message: string } | null }> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<{ error: { message: string } }>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            error: { message: `no answer within ${SEND_TIMEOUT_MS / 1000} s` },
          }),
        SEND_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([this.resend.emails.send(payload), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const { error } = await this.send({
      from: this.from,
      to: email.to,
      subject: 'Reset your Emarath password',
      text:
        `We received a request to reset your Emarath password.\n\n` +
        `Use this link to choose a new one — it can be used once and expires soon:\n` +
        `${email.resetUrl}\n\n` +
        `If you didn't request this, you can ignore this email.`,
    });
    if (error) {
      // Surface the failure to the caller's logs without leaking recipient details beyond
      // what we already hold; the request path swallows this so it never reveals whether
      // an account exists (AC2).
      this.logger.error(`Resend send failed: ${error.message}`);
      throw new Error('Failed to send password reset email.');
    }
  }

  async sendMail(email: OutboundEmail): Promise<void> {
    // `from` is the verified `MAIL_FROM`, never caller-supplied — Resend rejects an
    // unverified sender, so a spoofed From cannot go out (and cannot be `yopmail`/`gmail`).
    const { error } = await this.send({
      from: this.from,
      to: email.to,
      cc: email.cc?.length ? email.cc : undefined,
      bcc: email.bcc?.length ? email.bcc : undefined,
      subject: email.subject,
      text: email.text,
    });
    if (error) {
      this.logger.error(`Resend send failed: ${error.message}`);
      throw new Error('Failed to send the email.');
    }
  }
}

/**
 * No email provider is configured, which is the default outside development. Nothing is sent,
 * logged or recorded: a send refuses with a 503, so no caller can report an email that never
 * left, and the message holds no link or address.
 */
@Injectable()
export class DisabledMailerService extends MailerService {
  readonly enabled = false;

  sendPasswordReset(): Promise<void> {
    return Promise.reject(
      new ServiceUnavailableException(EMAIL_DISABLED_MESSAGE),
    );
  }

  sendMail(): Promise<void> {
    return Promise.reject(
      new ServiceUnavailableException(EMAIL_DISABLED_MESSAGE),
    );
  }
}

/** The adapter the `mail` config names. Feature code depends only on `MailerService`. */
export function createMailer(config: ConfigService): MailerService {
  const { provider } = config.getOrThrow<MailConfig>('mail');
  if (provider === 'resend') return new ResendMailerService(config);
  if (provider === 'log') return new LogMailerService();
  return new DisabledMailerService();
}
