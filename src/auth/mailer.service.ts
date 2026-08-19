import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { MailConfig } from '../config/mail.config';

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
 * injection token: callers depend on this type and the module binds the environment's
 * adapter (log in development, Resend in staging/production). `sendPasswordReset` is the
 * auth link; `sendMail` is the general composer send the Lead Email action (ADR-0032)
 * reuses rather than standing up a second transport.
 */
export abstract class MailerService {
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
 * Staging/production transport: sends the reset link via Resend (ADR-0031). Uses the HTTP
 * API (port 443 only — no SMTP egress concerns on Render). The from-address and API key
 * come from the `mail` config, which requires them when this adapter is selected.
 */
@Injectable()
export class ResendMailerService extends MailerService {
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

  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const { error } = await this.resend.emails.send({
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
    const { error } = await this.resend.emails.send({
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
