import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MailConfig } from '../config/mail.config';
import {
  DisabledMailerService,
  EMAIL_DISABLED_MESSAGE,
  LogMailerService,
  MailerService,
  ResendMailerService,
  createMailer,
} from './mailer.service';

describe('LogMailerService (AUTH-03.1)', () => {
  it('logs the reset link (the dev "delivery") and resolves', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const mailer = new LogMailerService();

    await expect(
      mailer.sendPasswordReset({
        to: 'agent@emarath.local',
        resetUrl: 'http://localhost:3000/reset-password?token=abc',
      }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:3000/reset-password?token=abc'),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('agent@emarath.local'),
    );
    spy.mockRestore();
  });
});

describe('DisabledMailerService (email is optional)', () => {
  const reset = {
    to: 'agent@emarath.local',
    resetUrl: 'https://app.example.test/reset-password?token=abc',
  };
  const outbound = { to: ['agent@emarath.local'], subject: 'Hi', text: 'Body' };

  it('reports itself disabled and refuses every send with a clear 503', async () => {
    const mailer: MailerService = new DisabledMailerService();
    expect(mailer.enabled).toBe(false);
    await expect(mailer.sendPasswordReset(reset)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(mailer.sendMail(outbound)).rejects.toMatchObject({
      message: EMAIL_DISABLED_MESSAGE,
    });
  });

  it('logs nothing, so neither the reset link nor the email content reaches the log', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const mailer: MailerService = new DisabledMailerService();

    await mailer.sendPasswordReset(reset).catch(() => undefined);
    await mailer.sendMail(outbound).catch(() => undefined);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
    warn.mockRestore();
  });
});

describe('createMailer', () => {
  const configFor = (provider: MailConfig['provider']) =>
    ({
      getOrThrow: () => ({
        provider,
        resendApiKey: 'test-key-not-real',
        from: 'Emarath <no-reply@example.test>',
        webAppUrl: 'https://app.example.test',
      }),
    }) as unknown as ConfigService;

  it('binds the adapter the config names', () => {
    expect(createMailer(configFor('disabled'))).toBeInstanceOf(
      DisabledMailerService,
    );
    expect(createMailer(configFor('log'))).toBeInstanceOf(LogMailerService);
    expect(createMailer(configFor('resend'))).toBeInstanceOf(
      ResendMailerService,
    );
  });
});
