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
 * Outbound mail port (AUTH-03.1, ADR-0031). An abstract class so it can be a Nest
 * injection token: AuthService depends on this type and the module binds the environment's
 * adapter (log in development, Resend in staging/production). Deliberately narrow — the
 * only message the backlog needs is the password-reset link; a general `sendMail` would be
 * speculative surface.
 */
export abstract class MailerService {
  abstract sendPasswordReset(email: PasswordResetEmail): Promise<void>;
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
}
