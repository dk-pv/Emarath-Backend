import { isolateE2eDatabase } from '../src/prisma/database-target';

// Runs before each e2e file loads the app (`setupFiles` in jest-e2e.json), so the database URL
// the app reads is the isolated one and never the developer's `.env` (ADR-0095).
isolateE2eDatabase(process.env);
