import { createHash, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserRole } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import authConfig, { DEV_INSECURE_SECRET } from './auth.config';
import mailConfig from './mail.config';
import {
  MIN_SECRET_LENGTH,
  PUBLISHED_SECRET_SHA256,
  assertStrongSecret,
} from './secret-strength';
import storageConfig, { DEV_INSECURE_SIGNING_SECRET } from './storage.config';

/*
  Staging and production refuse to boot on an unsafe secret or a development-only transport, and
  set Secure cookies; development keeps its insecure defaults so a fresh clone runs (ADR-0095).
*/

/** Each run gets a fresh random value: nothing secret-looking is written into this file. */
const strong = () => randomBytes(32).toString('base64');

/**
 * Runs `check` with `value` counted as published (S1). The real published values never appear in
 * this file, so a fresh random value stands in for one; its fingerprint is removed afterwards.
 */
function whilePublished(value: string, check: () => void): void {
  const fingerprints = PUBLISHED_SECRET_SHA256 as Set<string>;
  const fingerprint = createHash('sha256').update(value).digest('hex');
  fingerprints.add(fingerprint);
  try {
    check();
  } finally {
    fingerprints.delete(fingerprint);
  }
}

const KEYS = [
  'NODE_ENV',
  'JWT_ACCESS_SECRET',
  'COOKIE_SAMESITE',
  'CORS_ORIGIN',
  'MAIL_PROVIDER',
  'RESEND_API_KEY',
  'MAIL_FROM',
  'WEB_APP_URL',
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

  it('refuses a value this repository published, with stray whitespace or quotes too, without repeating it (S1)', () => {
    const value = strong();
    whilePublished(value, () => {
      for (const configured of [
        value,
        ` ${value}\n`,
        `"${value}"`,
        ` '${value}' `,
        `" ${value} "`,
      ]) {
        let message = '';
        try {
          assertStrongSecret('SOME_SECRET', configured);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toMatch(
          /^SOME_SECRET was published in this repository and must be rotated\./,
        );
        expect(message).not.toContain(value);
      }
    });
    expect(() => assertStrongSecret('SOME_SECRET', value)).not.toThrow();
  });

  it('holds only fingerprints of the two published secrets, never a value', () => {
    expect(PUBLISHED_SECRET_SHA256.size).toBe(2);
    for (const fingerprint of PUBLISHED_SECRET_SHA256) {
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
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
      setEnv({
        NODE_ENV: nodeEnv,
        JWT_ACCESS_SECRET: secret,
        COOKIE_SAMESITE: 'none',
      });
      const config = authConfig();
      expect(config.jwtAccessSecret).toBe(secret);
      expect(config.cookieSecure).toBe(true);
      expect(config.cookieSameSite).toBe('none');
    },
  );

  it.each(['staging', 'production'])(
    'refuses to boot %s on a JWT_ACCESS_SECRET this repository published (S1)',
    (nodeEnv) => {
      const secret = strong();
      setEnv({
        NODE_ENV: nodeEnv,
        JWT_ACCESS_SECRET: secret,
        COOKIE_SAMESITE: 'none',
      });
      whilePublished(secret, () => {
        expect(() => authConfig()).toThrow(
          /^JWT_ACCESS_SECRET was published in this repository and must be rotated\./,
        );
      });
      expect(authConfig().jwtAccessSecret).toBe(secret);
    },
  );

  it('lets development keep its secret even if it was published: only hosted boots are refused', () => {
    const secret = strong();
    setEnv({ NODE_ENV: 'development', JWT_ACCESS_SECRET: secret });
    whilePublished(secret, () => {
      expect(authConfig().jwtAccessSecret).toBe(secret);
    });
  });

  it.each(['staging', 'production'])(
    'refuses to boot %s without an explicit COOKIE_SAMESITE (C4)',
    (nodeEnv) => {
      for (const sameSite of [undefined, '', '  ']) {
        setEnv(
          sameSite === undefined
            ? { NODE_ENV: nodeEnv, JWT_ACCESS_SECRET: strong() }
            : {
                NODE_ENV: nodeEnv,
                JWT_ACCESS_SECRET: strong(),
                COOKIE_SAMESITE: sameSite,
              },
        );
        expect(() => authConfig()).toThrow(
          /^COOKIE_SAMESITE must be set outside development: "none" when the frontend and the API are on different sites/,
        );
      }
    },
  );

  it.each([
    ['none', 'none'],
    ['lax', 'lax'],
    ['strict', 'strict'],
    ['None', 'none'],
    [' none ', 'none'],
  ] as const)(
    'accepts COOKIE_SAMESITE=%s outside development',
    (value, expected) => {
      setEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strong(),
        COOKIE_SAMESITE: value,
      });
      expect(authConfig().cookieSameSite).toBe(expected);
    },
  );

  it('still refuses a COOKIE_SAMESITE the cookies cannot use, and keeps lax as the development default', () => {
    setEnv({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: strong(),
      COOKIE_SAMESITE: 'sometimes',
    });
    expect(() => authConfig()).toThrow(/Invalid COOKIE_SAMESITE "sometimes"/);
    setEnv({ NODE_ENV: 'development' });
    expect(authConfig().cookieSameSite).toBe('lax');
  });

  it('rejects a session token signed with the development default once a hosted secret is in force', async () => {
    setEnv({
      NODE_ENV: 'staging',
      JWT_ACCESS_SECRET: strong(),
      COOKIE_SAMESITE: 'none',
    });
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
      WEB_APP_URL: 'https://app.example.test',
      CORS_ORIGIN: 'https://app.example.test',
    });
    expect(mailConfig().provider).toBe('resend');
  });

  describe('WEB_APP_URL when Resend sends from a hosted deploy (C3)', () => {
    const resend = (vars: Record<string, string>) =>
      setEnv({
        NODE_ENV: 'production',
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-key-not-real',
        MAIL_FROM: 'Emarath <no-reply@example.test>',
        CORS_ORIGIN: 'https://app.example.test,https://admin.example.test',
        ...vars,
      });

    it.each([
      ['unset', undefined, /WEB_APP_URL is not set\./],
      ['blank', '  ', /WEB_APP_URL is not set\./],
      ['not a URL', 'app.example.test', /WEB_APP_URL is not a valid URL\./],
      ['plain http', 'http://app.example.test', /must use https/],
      ['localhost', 'https://localhost:3000', /points at this machine/],
      ['a loopback address', 'https://127.0.0.1', /points at this machine/],
      ['IPv6 loopback', 'https://[::1]', /points at this machine/],
      ['a path', 'https://app.example.test/app', /must be an origin only/],
      ['a query', 'https://app.example.test/?a=1', /must be an origin only/],
      ['credentials', 'https://user:pw@app.example.test', /origin only/],
      [
        'an origin outside CORS_ORIGIN',
        'https://other.example.test',
        /is not one of the CORS_ORIGIN origins/,
      ],
    ])('refuses to boot when it is %s', (_label, value, why) => {
      resend(value === undefined ? {} : { WEB_APP_URL: value });
      let message = '';
      try {
        mailConfig();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(why);
      expect(message).toMatch(/password-reset emails link to it/);
      if (value?.trim()) expect(message).not.toContain(value.trim());
    });

    it('says how to write CORS_ORIGIN when the list, not WEB_APP_URL, is malformed', () => {
      resend({
        CORS_ORIGIN: 'https://app.example.test/',
        WEB_APP_URL: 'https://app.example.test',
      });
      expect(() => mailConfig()).toThrow(
        /is not one of the CORS_ORIGIN origins \(each written as the browser sends it: lowercase, no trailing slash\)/,
      );
    });

    it('accepts an https origin listed in CORS_ORIGIN, with or without a trailing slash', () => {
      for (const value of [
        'https://admin.example.test',
        'https://admin.example.test/',
      ]) {
        resend({ WEB_APP_URL: value });
        expect(mailConfig().webAppUrl).toBe('https://admin.example.test');
      }
    });

    it('leaves it alone when no mail is sent, and in development', () => {
      setEnv({ NODE_ENV: 'production', MAIL_PROVIDER: 'disabled' });
      expect(mailConfig().webAppUrl).toBe('http://localhost:3000');
      setEnv({
        NODE_ENV: 'development',
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'test-key-not-real',
        MAIL_FROM: 'Emarath <no-reply@example.test>',
        WEB_APP_URL: 'http://localhost:3000',
      });
      expect(mailConfig().webAppUrl).toBe('http://localhost:3000');
    });
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

  it('refuses a published STORAGE_SIGNING_SECRET only where it signs links (S1)', () => {
    const secret = strong();
    whilePublished(secret, () => {
      setEnv({
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 'local',
        STORAGE_SIGNING_SECRET: secret,
      });
      expect(() => storageConfig()).toThrow(
        /^STORAGE_SIGNING_SECRET was published in this repository and must be rotated\./,
      );
      setEnv({
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 's3',
        STORAGE_BUCKET: 'bucket',
        STORAGE_ACCESS_KEY_ID: 'test-key-id-not-real',
        STORAGE_SECRET_ACCESS_KEY: 'test-secret-not-real',
        STORAGE_SIGNING_SECRET: secret,
      });
      expect(storageConfig().provider).toBe('s3');
    });
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
