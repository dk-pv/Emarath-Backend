/**
 * The values the Leads filter panel offers for each filterable field (LEAD-03.3).
 *
 * Source and Status are user-defined free text (no enum), so the only truthful
 * option list is the values actually present in the caller's scoped leads. The
 * lists are therefore facets of the data, computed per request under the same
 * role scope as the list itself — an agent never sees a source, status or
 * colleague that does not appear on a lead they may open.
 */
export interface LeadFilterOptions {
  sources: string[];
  statuses: string[];
  agents: { id: string; name: string }[];
  /** LEAD-12.1 AC4: the tags present on the caller's scoped leads. */
  tags: { id: string; name: string }[];
}
