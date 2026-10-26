import type { NextFunction, Request, Response } from 'express';

/** Methods that change nothing, so a cross-site one can do no harm. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses a state-changing request that a browser sent from a page on another site (CSRF).
 *
 * Hosted, the frontend and the API live on different sites, so the session cookies must be
 * `SameSite=None` — and then a hostile page's form post or no-CORS `fetch` carries them. CORS
 * only stops that page reading the answer; the write would already have happened. Browsers
 * name the sending page's origin on every such request, so one outside the CORS allow-list is
 * refused here, before body parsing and before any guard. A request without an `Origin` header
 * does not come from a browser page, holds no victim's cookies, and passes as before.
 */
export function rejectForeignOrigins(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || origin === undefined) return next();
    if (allowed.has(origin)) return next();
    res.status(403).json({
      statusCode: 403,
      message:
        'This request came from a site that is not allowed to change data here.',
      error: 'Forbidden',
    });
  };
}
