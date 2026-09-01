import { IsBoolean } from 'class-validator';

/**
 * Enable or disable one integration (INT-02.2 AC1).
 *
 * `enabled` is the only writable field. The rest of a registry row — name, description,
 * category, logo, detail link, order — is reference data loaded by the seed (INT-01.1
 * AC5), not user content, so no endpoint edits it.
 */
export class UpdateIntegrationDto {
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled!: boolean;
}

/** One integration as the API returns it. */
export interface IntegrationResponse {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  logo: string;
  enabled: boolean;
  detailUrl: string | null;
  position: number;
}
