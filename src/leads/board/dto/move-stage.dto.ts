import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { LeadListItem } from '../../dto/lead-response.dto';
import { BoardStageSummary } from './board-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A Kanban board move (KAN-04.1): the stage to move the dragged lead into.
 *
 * The DTO only checks the shape (a non-blank stage name); membership is validated in
 * the service against the canonical `Stage` catalogue for the lead's own pipeline
 * (KAN-05.1) — which the static list here used to approximate — so an unknown target
 * is rejected with a clear 400 before any write (AC4). Only the stage is sent: a
 * board move changes the lead's stage (its `status`, LEAD-01.1 AC3), never its
 * pipeline, so the lead keeps the board it is already on.
 */
export class MoveLeadStageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'stage is required' })
  @MaxLength(64)
  stage!: string;
}

/**
 * A move's result: the updated lead plus the source and target columns recounted,
 * so the board refreshes those two counts and value totals without a full reload
 * (KAN-04.1 AC3). The `pipeline` echoes the board the move stayed on.
 */
export interface MoveLeadStageResponse {
  lead: LeadListItem;
  pipeline: string;
  stages: BoardStageSummary[];
}
