import type { NextFunction, Request, Response } from 'express';
import { authContext } from './auth-context';

/**
 * Opens a fresh auth store for each request and runs the rest of the pipeline inside
 * it, so the guard's write and the services' reads share one per-request context.
 * Registered globally in `main.ts`, after cookie parsing.
 */
export function authContextMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  authContext.run({}, () => next());
}
