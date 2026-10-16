// The local-database check of src/prisma/database-target.ts (ADR-0095), for seed-calls.mjs, which
// runs with plain node and no build. Keep the two in step: database-target.spec.ts runs both
// against the same cases.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Whether `url` is a postgres URL whose host is this machine. Anything unreadable is not. */
export function isLocalDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return false;
  }
  // node-postgres connects to the last `host` parameter, so more than one is refused.
  const hosts = parsed.searchParams.getAll('host');
  if (hosts.length > 1) {
    return false;
  }
  const host = (hosts[0] ?? parsed.hostname)
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    LOCAL_HOSTS.has(host) ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('/')
  );
}

/** Refuses, before any connection, a target that is not on this machine. There is no override. */
export function assertLocalDatabase(script, url) {
  if (!url || !isLocalDatabase(url)) {
    throw new Error(
      `${script} refuses to run: it only writes to a disposable database on this machine.`,
    );
  }
}
