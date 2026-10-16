/**
 * Outside development, a secret that signs sessions or links must be long and random (ADR-0095):
 * set, at least 32 characters, not a placeholder or a development default shipped in this
 * repository, and not a short run of repeated characters. The error names the variable and the
 * rule it breaks, never the value.
 */
export const MIN_SECRET_LENGTH = 32;

/** The markers of the example and development values in `.env.example` and the config files. */
const PLACEHOLDER =
  /change[-_ ]?me|placeholder|replace[-_ ]?me|your[-_ ]?secret|example|insecure/i;

export function assertStrongSecret(
  name: string,
  value: string | undefined,
): asserts value is string {
  const problem = !value
    ? 'is not set'
    : value.length < MIN_SECRET_LENGTH
      ? `is shorter than ${MIN_SECRET_LENGTH} characters`
      : PLACEHOLDER.test(value)
        ? 'is a placeholder or a development default'
        : new Set(value).size < 10
          ? 'is too repetitive to be random'
          : null;
  if (problem) {
    throw new Error(
      `${name} ${problem}. Outside development it must be a long random value, for example the output of \`openssl rand -base64 48\`.`,
    );
  }
}
