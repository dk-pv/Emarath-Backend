import { Module } from '@nestjs/common';
import { ImportEngineService } from './import-engine.service';

/**
 * The reusable import engine, exported for any feature module to compose.
 *
 * Holds only the module-agnostic engine — parsing, mapping, validation, dedupe and
 * batching. A feature module (Leads today; Customers/Products later) imports this
 * and supplies its own descriptor.
 */
@Module({
  providers: [ImportEngineService],
  exports: [ImportEngineService],
})
export class ImportModule {}
