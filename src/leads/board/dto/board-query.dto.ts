import { ListLeadsQueryDto } from '../../dto/list-leads-query.dto';

/**
 * The board query (KAN-02.1, extended KAN-07.1). It IS the Leads list query: the
 * board carries the same search, field filters and Quick Filter presets, parsed by
 * the identical DTO so there is one contract and one `buildLeadWhere` — the board
 * can never filter differently from the list it groups (KAN-07.1 AC1/AC5). The
 * paging/sort fields it inherits are unused by the rollup (a groupBy has its own
 * order); only the `where` inputs matter here.
 *
 * `pipeline` selects which board to group; it is optional on the list, so the
 * service defaults it to the Workpex default "Lead Pipeline" when absent, keeping a
 * bare `GET /api/leads/board` returning the sales board.
 */
export class BoardQueryDto extends ListLeadsQueryDto {}

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
