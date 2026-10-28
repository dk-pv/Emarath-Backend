import { randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import authConfig, { DEV_INSECURE_SECRET } from './auth.config';
import mailConfig from './mail.config';
import { MIN_SECRET_LENGTH, assertStrongSecret } from './secret-strength';
import storageConfig, { DEV_INSECURE_SIGNING_SECRET } from './storage.config';

/*
  Staging and production refuse to boot on an unsafe secret or a development-only transport, and
  set Secure cookies; development keeps its insecure defaults so a fresh clone runs (ADR-0095).
*/

/** Each run gets a fresh random value: nothing secret-looking is written into this file. */
const strong = () => randomBytes(32).toString('base64');

const KEYS = [
  'NODE_ENV',
  'JWT_ACCESS_SECRET',
  'COOKIE_SAMESITE',
  'MAIL_PROVIDER',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'STORAGE_PROVIDER',
  'STORAGE_SIGNING_SECRET',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_MAX_BYTES',
];

const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function setEnv(vars: Record<string, string>): void {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, vars);
}

afterAll(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('assertStrongSecret', () => {
  const rejects = (value: string | undefined, why: RegExp) =>
    expect(() => assertStrongSecret('SOME_SECRET', value)).toThrow(why);

  it('refuses a missing or empty secret', () => {
    rejects(undefined, /SOME_SECRET is not set/);
    rejects('', /SOME_SECRET is not set/);
  });

  it(`refuses one shorter than ${MIN_SECRET_LENGTH} characters`, () => {
    rejects(strong().slice(0, MIN_SECRET_LENGTH - 1), /shorter than 32/);
  });

  it.each([
    ['the .env.example placeholder', 'change-me-to-a-long-random-string'],
    ['the development JWT fallback', DEV_INSECURE_SECRET],
    ['the development storage fallback', DEV_INSECURE_SIGNING_SECRET],
  ])('refuses %s', (_, value) => {
    rejects(value, /placeholder or a development default/);
  });

  it('refuses a long run of a few repeated characters', () => {
    rejects('a'.repeat(48), /too repetitive/);
    rejects('ab12'.repeat(12), /too repetitive/);
  });

  it('accepts a long random value', () => {
    expect(() => assertStrongSecret('SOME_SECRET', strong())).not.toThrow();
  });

  it('never repeats the value it refuses', () => {
    const value = 'example-value-that-is-long-enough-to-check';
    let message = '';
    try {
      assertStrongSecret('SOME_SECRET', value);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^SOME_SECRET /);
    expect(message).not.toContain(value);
  });
});

describe('auth config', () => {
  it('lets development and the test suite run on the insecure default, without Secure cookies', () => {
    for (const nodeEnv of ['development', 'test']) {
      setEnv({ NODE_ENV: nodeEnv });
      const config = authConfig();
      expect(config.jwtAccessSecret).toBe(DEV_INSECURE_SECRET);
      expect(config.cookieSecure).toBe(false);
    }
  });

  it.each(['staging', 'production'])(
    'refuses to boot %s without a strong JWT_ACCESS_SECRET',
    (nodeEnv) => {
      for (const secret of [
        undefined,
        'short',
        DEV_INSECURE_SECRET,
        'change-me-to-a-long-random-string',
      ]) {
        setEnv(
          secret === undefined
            ? { NODE_ENV: nodeEnv }
            : { NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: secret },
        );
        expect(() => authConfig()).toThrow(/JWT_ACCESS_SECRET/);
      }
    },
  );

  it.each(['staging', 'production'])(
    'uses a strong secret and Secure cookies in %s',
    (nodeEnv) => {
      const secret = strong();
      setEnv({ NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: secret });
      const config = authConfig();
      expect(config.jwtAccessSecret).toBe(secret);
      expect(config.cookieSecure).toBe(true);
    },
  );

  it('rejects a session token signed with the development default once a hosted secret is in force', async () => {
    setEnv({ NODE_ENV: 'staging', JWT_ACCESS_SECRET: strong() });
    const hosted = new JwtService({ secret: authConfig().jwtAccessSecret });
    const claims = {
      sub: '0b8a4c56-3d1e-4f2a-9b7c-5e6d7f8a9b0c',
      role: UserRole.SUPERADMIN,
    };
    const signOptions = { issuer: 'emarath-api', audience: 'emarath-app' };
    const liveAccount = {
      user: { findFirst: () => Promise.resolve({ id: claims.sub }) },
    } as unknown as PrismaService;
    const guard = new JwtAuthGuard(
      hosted,
      { getAllAndOverride: () => false } as unknown as Reflector,
      liveAccount,
    );
    const contextFor = (token: string) =>
      ({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => ({ cookies: { access_token: token } }),
        }),
      }) as unknown as ExecutionContext;

    const forged = await new JwtService({
      secret: DEV_INSECURE_SECRET,
    }).signAsync(claims, signOptions);
    await expect(guard.canActivate(contextFor(forged))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const genuine = await hosted.signAsync(claims, signOptions);
    await expect(guard.canActivate(contextFor(genuine))).resolves.toBe(true);
  });
});

describe('mail config', () => {
  it('uses the log transport in development, explicitly or by default', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(mailConfig().provider).toBe('log');
    setEnv({ NODE_ENV: 'development', MAIL_PROVIDER: 'log' });
    expect(mailConfig().provider).toBe('log');
  });

  it.each(['staging', 'production'])(
    'refuses the log transport in %s',
    (nodeEnv) => {
      setEnv({ NODE_ENV: nodeEnv, MAIL_PROVIDER: 'log' });
      expect(() => mailConfig()).toThrow(
        /MAIL_PROVIDER "log" is only allowed in development/,
      );
    },
  );

  it('starts outside development with no provider, so email stays disabled', () => {
    for (const nodeEnv of ['staging', 'production']) {
      setEnv({ NODE_ENV: nodeEnv });
      const config = mailConfig();
      expect(config.provider).toBe('disabled');
      expect(config.resendApiKey).toBeNull();
    }
  });

  it('treats a blank MAIL_PROVIDER as unset', () => {
    setEnv({ NODE_ENV: 'production', MAIL_PROVIDER: '  ' });
    expect(mailConfig().provider).toBe('disabled');
  });

  it('accepts disabled explicitly, in development as well', () => {
    setEnv({ NODE_ENV: 'production', MAIL_PROVIDER: 'disabled' });
    expect(mailConfig().provider).toBe('disabled');
    setEnv({ NODE_ENV: 'development', MAIL_PROVIDER: 'disabled' });
    expect(mailConfig().provider).toBe('disabled');
  });

  it('keeps Resend strict: selecting it outside development still needs its key and sender', () => {
    setEnv({ NODE_ENV: 'staging', MAIL_PROVIDER: 'resend' });
    expect(() => mailConfig()).toThrow(/RESEND_API_KEY and MAIL_FROM/);
    setEnv({
      NODE_ENV: 'staging',
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-key-not-real',
    });
    expect(() => mailConfig()).toThrow(/RESEND_API_KEY and MAIL_FROM/);
    setEnv({
      NODE_ENV: 'staging',
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-key-not-real',
      MAIL_FROM: 'Emarath <no-reply@example.test>',
    });
    expect(mailConfig().provider).toBe('resend');
  });

  it('refuses an unknown provider', () => {
    setEnv({ NODE_ENV: 'production', MAIL_PROVIDER: 'smtp' });
    expect(() => mailConfig()).toThrow(/Invalid MAIL_PROVIDER "smtp"/);
  });
});

describe('storage config', () => {
  it('signs local development links with the insecure default', () => {
    setEnv({ NODE_ENV: 'development' });
    const config = storageConfig();
    expect(config.provider).toBe('local');
    expect(config.localSigningSecret).toBe(DEV_INSECURE_SIGNING_SECRET);
  });

  it.each(['staging', 'production'])(
    'refuses local storage in %s without a strong STORAGE_SIGNING_SECRET',
    (nodeEnv) => {
      for (const secret of [undefined, DEV_INSECURE_SIGNING_SECRET, 'short']) {
        setEnv(
          secret === undefined
            ? { NODE_ENV: nodeEnv, STORAGE_PROVIDER: 'local' }
            : {
                NODE_ENV: nodeEnv,
                STORAGE_PROVIDER: 'local',
                STORAGE_SIGNING_SECRET: secret,
              },
        );
        expect(() => storageConfig()).toThrow(/STORAGE_SIGNING_SECRET/);
      }
      const secret = strong();
      setEnv({
        NODE_ENV: nodeEnv,
        STORAGE_PROVIDER: 'local',
        STORAGE_SIGNING_SECRET: secret,
      });
      expect(storageConfig().localSigningSecret).toBe(secret);
    },
  );

  it('does not ask S3 for a signing secret it never uses', () => {
    setEnv({
      NODE_ENV: 'production',
      STORAGE_PROVIDER: 's3',
      STORAGE_BUCKET: 'bucket',
      STORAGE_ACCESS_KEY_ID: 'test-key-id-not-real',
      STORAGE_SECRET_ACCESS_KEY: 'test-secret-not-real',
    });
    expect(storageConfig().provider).toBe('s3');
  });

  it('keeps the 25 MB default when STORAGE_MAX_BYTES is absent', () => {
    setEnv({ NODE_ENV: 'development' });
    expect(storageConfig().maxBytes).toBe(25 * 1024 * 1024);
    setEnv({ NODE_ENV: 'development', STORAGE_MAX_BYTES: '1024' });
    expect(storageConfig().maxBytes).toBe(1024);
  });

  it.each(['', 'abc', '25MB', '1.5', '0', '-1', '+5', '1e6', ' 1024'])(
    'refuses STORAGE_MAX_BYTES %j instead of guessing a limit',
    (value) => {
      setEnv({ NODE_ENV: 'development', STORAGE_MAX_BYTES: value });
      expect(() => storageConfig()).toThrow(/Invalid STORAGE_MAX_BYTES/);
    },
  );
});
