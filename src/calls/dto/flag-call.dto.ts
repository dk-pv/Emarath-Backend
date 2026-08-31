import { IsBoolean } from 'class-validator';

/** The Recent Call Log's Flag action — a persisted per-call toggle. */
export class FlagCallDto {
  @IsBoolean({ message: 'flagged must be true or false' })
  flagged!: boolean;
}
