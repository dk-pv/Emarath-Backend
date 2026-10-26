import type { NextFunction, Request, Response } from 'express';
import { rejectForeignOrigins } from './origin-check.middleware';

const ALLOWED = ['https://app.example', 'http://localhost:3000'];

function run(method: string, origin?: string) {
  const req = {
    method,
    headers: origin === undefined ? {} : { origin },
  } as Request;
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next = jest.fn() as NextFunction;
  rejectForeignOrigins(ALLOWED)(req, res, next);
  return { next, status, json };
}

describe('rejectForeignOrigins (CSRF)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses a %s sent from a page on another site, before anything else runs',
    (method) => {
      const { next, status, json } = run(method, 'https://evil.example');
      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403, error: 'Forbidden' }),
      );
    },
  );

  it('refuses the opaque "null" origin of sandboxed frames and local files', () => {
    expect(run('POST', 'null').status).toHaveBeenCalledWith(403);
  });

  it('lets a write from an allowed origin through', () => {
    for (const origin of ALLOWED) {
      expect(run('POST', origin).next).toHaveBeenCalledTimes(1);
    }
  });

  it('compares the whole origin, so a look-alike host or another port is refused', () => {
    expect(
      run('POST', 'https://app.example.evil.example').next,
    ).not.toHaveBeenCalled();
    expect(run('POST', 'http://localhost:3001').next).not.toHaveBeenCalled();
  });

  it('lets a request without an Origin header through: it is not from a browser page', () => {
    expect(run('POST').next).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'never refuses a %s, which changes nothing, whatever its origin',
    (method) => {
      expect(run(method, 'https://evil.example').next).toHaveBeenCalledTimes(1);
    },
  );
});
