import { Logger } from '@nestjs/common';
import { LogMailerService } from './mailer.service';

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
