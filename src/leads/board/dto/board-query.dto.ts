import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The board query (KAN-02.1): which pipeline to group by. Defaults to the Workpex
 * default board "Lead Pipeline" (the same default as `Lead.pipeline`), so a bare
 * `GET /api/leads/board` returns the sales board.
 */
export class BoardQueryDto {
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' && value.trim() ? value.trim() : 'Lead Pipeline',
  )
  @IsString({ message: 'pipeline must be a string' })
  @MaxLength(64, { message: 'pipeline must be at most 64 characters' })
  @IsOptional()
  pipeline: string = 'Lead Pipeline';
}

/** One board column's rollup: the stage, how many leads sit in it, their total value. */
export interface BoardStageSummary {
  stage: string;
  count: number;
  /** Summed `actualAmount`, as a string — Decimal precision must survive the wire. */
  totalValue: string;
}

/** The board data for one pipeline (KAN-02.1). */
export interface LeadBoardResponse {
  pipeline: string;
  stages: BoardStageSummary[];
  /** The pipeline-wide rollup (KAN-06.1 AC5). */
  totals: { count: number; totalValue: string };
}
