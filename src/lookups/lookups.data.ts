/**
 * Config-backed lookup data (Phase 1, ADR-0005).
 *
 * These lists back the New Lead form's dropdowns. They live in code, not a
 * database table, deliberately: the ERP foundation is still moving, and a
 * reference-table schema would be premature. The values are transcribed from the
 * Workpex `add-lead.mp4` walkthrough, which opens every dropdown.
 *
 * The service exposes them behind `GET /api/lookups/:type`, returning
 * `{ value, label }[]`. When these graduate to database tables, only this file
 * and the service change — the endpoint contract and the frontend stay the same.
 */

export interface LookupOption {
  value: string;
  label: string;
}

/** Lists whose values differ from their labels do not exist yet, so value = label. */
function options(values: readonly string[]): LookupOption[] {
  return values.map((value) => ({ value, label: value }));
}

// Lead status is no longer config-backed: it graduated to the `Stage` catalogue
// (KAN-05.1), the single user-editable source the board, badges and this form read.
// `LookupsService` serves `leadStatus` from that table; there is no hard-coded copy.

/** Pipeline/board — separate axis from status (ADR-0005). Default "Lead Pipeline". */
const PIPELINE = ['Lead Pipeline', 'Complaints', 'LOGISTICS', 'QC'] as const;

const LANGUAGE = [
  'Malayalam',
  'English',
  'Hindi',
  'Arabic',
  'Tamil',
  'Others',
] as const;

const SOURCE = [
  'Broadcast',
  'Cancel/Reorder',
  'Complaint',
  'Direct',
  'DoubleTick',
  'Facebook',
  'GOOGLE ADS',
  'Instagram',
  'OLD DATA',
  'Other',
  'REFERRAL',
  'Reorder',
  'Website',
  'Lead/Reorder',
] as const;

const CALL_STATUS = [
  'Invalid Number',
  'No Response',
  'Call Declined',
  'Answered',
] as const;

/** The dropdown offers these fixed counts; the field itself stores an integer. */
const ATTEMPT_COUNT = ['0', '1', '2', '3', '4'] as const;

const CATEGORY = ['Default', 'Logistics'] as const;

const PAYMENT_METHOD = [
  'COD',
  'Account Transfer',
  'Quick Link',
  'Tabby',
  'Tamara',
  'Not available',
] as const;

const COMPLAINT_REASON = [
  'PRODUCT DAMAGE',
  'LASTING ISSUE',
  'UNSATISFIED',
  'DELIVERY DELAY',
  'REFUND ISSUE',
  'EXCHANGE',
  'RETURN',
  'WRONG ITEM',
  'MISSING PRODUCT',
  'MISBEHAVIOR',
  'SOLVED',
] as const;

/**
 * Product catalog (Phase 1 = names only, no Product entity). The full product list
 * verified against the live Workpex Add Lead form; the field stores the chosen name.
 * Product and Product 2 both read this one list. Preserves Workpex's exact display
 * text and order — including `NOT AVAILABLE` and the `_ATYAF`/`_LPG`/`_SCENT PASSION`/
 * `_OUD AL SALAM` and `+ GIFT PERFUME` suffixed variants — with two paste artefacts
 * corrected to their true Workpex values: `CHANEL N°5` (not the mojibake `NÂ°5`) and a
 * single `BRITNEY SPEARS FANTASY` (the source list duplicated it). Phase 2 promotes
 * this to a catalog entity if pricing/SKU is ever needed.
 */
const PRODUCT = [
  'MUKHALAT EMARATI',
  'MAQAM IBRAHIM',
  'QAMAR & KISMAT FRAGRANCE COMBO',
  'MIRAMAR COMBO',
  'HECTOR COMBO',
  'ASEEL PERFUME COMBO',
  'SHADOW FLAME PERFUME COMBO',
  'OLD MEMORIES PERFUME COMBO',
  'THE ARCHER COMBO',
  'VOLGA EDITION PERFUME COMBO',
  'JOVANO COMBO',
  'MYSTERY COMBO',
  'MOJEH COLLECTION PERFUME COMBO',
  'PEACOCK COLLECTION',
  'SEVEN DAYS',
  'ESENCIA FLORAL COLLECTION',
  'LAROCHE COMBO',
  'TELLURIDE',
  'SOLO LOEWE',
  'SEQUOIA',
  'PORTOFINO',
  'PINK BEACH',
  'PARIS RIVIERA',
  "OUD OF NO MEN'S LAND",
  'ORCHID IMPERIAL',
  'BRAZILIAN CRUSH',
  'GRIS DES VENTS',
  'ITALIAN CITRUS',
  'MOJAVE',
  'MOD NOIR',
  'AMEERAT AL ARAB 3-PIECE PERFUME SET',
  'AMBRE MAQUIS',
  'SUFI',
  'FERRAGAMO & SUFI COMBO',
  'CUPID FERRAGAMO',
  'BLUE SUFI',
  'SALTY FLOWER',
  'FREUDIAN WOOD',
  'BELLE DE TANGE',
  'ROSE SMOKE',
  'VELVET ROSE AND ROSE OUD',
  '786 FOUR-PIECE COMBO PERFUME SET',
  'BLACK AXCESS SPRAY',
  'SENSUAL SPRAY EDP',
  'WHITE OUD',
  'MARIYAM PERFUME',
  'SR SIGNATURE',
  'MANCERA RED TOBACCO',
  'CREED AVENTUS',
  'MFK BACCARAT ROUGE 540',
  'CK ETERNITY',
  'CREED SILVER MOUNTAIN WATER',
  'CHANCE CHANEL',
  'WHITE LACOSTE',
  'AMOUAGE INTERLUDE',
  'MISS DIOR CHERIE',
  'DOLCE & GABBANA LIGHT BLUE',
  'DOLCE & GABBANA THE ONE',
  'PACO RABANNE INVICTUS',
  'MONTBLANC LEGEND',
  'PACO RABANNE 1 MILLION GOLDEN OUD',
  'JIMMY CHOO FEMME',
  'DAVIDOFF SILVER SHADOW',
  'ESCADA COLLECTION',
  'PACO RABANNE BLACK XS',
  'DAVIDOFF COOL WATER',
  'DOLCE & GABBANA VELVET DESERT OUD',
  'DIOR MIDNIGHT POISON',
  'CHRISTIAN DIOR FAHRENHEIT',
  'CHANEL COCO MADEMOISELLE',
  'CALVIN KLEIN CK ONE',
  'CHANEL ALLURE HOMME SPORT',
  'TOMMY BY TOMMY HILFIGER',
  'CHANEL N°5',
  'YSL BLACK OPIUM',
  'CHANEL BLEU DE',
  'KILIAN BACK TO BLACK',
  'BRITNEY SPEARS FANTASY',
  'ERBA PURA XERJOFF',
  'SUPREME BOUQUET YSL FRAGRANTICA',
  'DIOR SAUVAGE',
  'GUCCI RUSH',
  'MANCERA ROSES VANILLE',
  'TOM FORD OUD WOOD',
  'CHOPARD OUD MALAKI',
  'PACO RABANNE 1 MILLION',
  'MAGIC',
  'TOM FORD LOST CHERRY',
  'LORENZO VILLORESI',
  "DIOR J'ADORE",
  'ICON ABSOLUTE ALFRED BY DUNHILL',
  'GUCCI GUILTY POUR HOMME',
  'FENDI',
  'ESCADA SEXY GRAFFITI',
  'ESCADA TAJ SUNSET',
  'VERSACE EROS',
  'ALFRED DUNHILL DESIRE RED',
  "TERRE D'HERMES",
  'VERSACE CRYSTAL NOIR',
  'VERSACE BRIGHT CRYSTAL',
  'TOM FORD BLACK ORCHID',
  'NASOMATTO BLACK',
  'HUGO BOSS',
  'XERJOFF ACCENTO',
  'MAISON FALCON COLLECTION',
  'ARBE PURO COMBO',
  'IVORY BLACK',
  'ASTORIA WILD NIGHT',
  'JUST WARDI',
  'VELORA POP HEART',
  'VELORA SUGAR BLISS',
  'VELORA VIVA CHOCO',
  'TOBACCO INCENSE',
  'VIVA CREAM',
  'BEAUTIFUL WEEKEND',
  'FURSAN AL LAIL',
  'OUD AL AMEER',
  'ZAFIRAH',
  'RANIA',
  'EJLAL',
  'CHERIE BLOSSOM COMBO',
  'LA FLORAL COMBO',
  'PINK WAY',
  'LIFE ES BELLA',
  'FLORAL BLOOM',
  'EXCLUSIF SIGNATURE PERFUME COMBO',
  'INTENSE SIGNATURE COMBO',
  'ENIGMA',
  'INTENSE PINK',
  'EXECUTIVE',
  'VELVET TOBACCO',
  'JOURNEY OF OUD BRILLANTE',
  'JOURNEY OF OUD OPULENT',
  'JOURNEY OF OUD BLUE MOON',
  'JOURNEY OF OUD IMPERIAL JADE',
  'JOURNEY OF OUD ROJA',
  'JENAN',
  'NAJAH PISTACHIO',
  'OMBRIA DE INTENSO',
  'RICARDO',
  'OPUS',
  'LEON',
  'ZARRA',
  'CHERIE PASSION',
  'JUICY BOMB',
  'OUD PRESTIGE',
  'IMPRESSIO',
  'ROSES IN OUD NUIT',
  'ROSES IN OUD',
  'LOVE IN LOVE IN OUD',
  'IMPERIAL LEGEND',
  'IMPERIAL',
  'CAVALIER GOLD',
  'CABRIOLE',
  'ORION',
  'MONTE CARLO',
  'INTENSE BROWN',
  'INTENSE BLACK',
  'NOT AVAILABLE',
  'LUCILLE',
  'AL HUDA_OUD AL SALAM',
  'PREMIUM COLLECTION_OUD AL SALAM',
  'LUMINEX_OUD AL SALAM',
  'AMBRE + ONIRO_SCENT PASSION',
  'AMEERATH UL ARAB_SCENT PASSION',
  'ARBE PURO COMBO_LPG',
  'ASEEL COMBO_ATYAF',
  'CLIVE COLLECTION_SCENT PASSION',
  'COLLECTION OF MOOD_ATYAF',
  'DOE COLLECTION_SCENT PASSION',
  'ESENCIA FLORAL_SCENT PASSION',
  'FALCON COLLECTION_LPG',
  '6 PS PERFUME COMPO_SCENT PASSION',
  'SHADOW FLAME_ATYAF',
  'OUD LOVERS_LPG',
  'HECTOR COMBO_ATYAF',
  'SALTY FLOWER_SCENT PASSION',
  'ABSOLUTE MOUNTAIN AVENUE_OUD AL SALAM',
  'CHERIE BLOSSOM_LPG',
  'MARIYAM LOTION',
  'DOLLER COMBO',
  'ROSE SMOKE + BLACK LUXES',
  'ROSE SMOKE + GIFT PERFUME',
  'SALT FLOWER + GIFT PERFUME',
  'VELVET ROSE + GIFT PERFUME',
  'AMBRE + GIFT PERFUME',
  'ITALIAN CITRUS + GIFT PERFUME',
  'FREUDIAN WOOD + GIFT PERFUME',
  'SANDAL OPIUM',
] as const;

/**
 * The config-backed lookup lists, keyed by the `:type` the endpoint accepts.
 * `tags` and `agents` are intentionally absent — they come from the database.
 */
export const LOOKUP_DATA = {
  pipelines: options(PIPELINE),
  languages: options(LANGUAGE),
  sources: options(SOURCE),
  callStatus: options(CALL_STATUS),
  attemptCounts: options(ATTEMPT_COUNT),
  categories: options(CATEGORY),
  paymentMethods: options(PAYMENT_METHOD),
  complaintReasons: options(COMPLAINT_REASON),
  products: options(PRODUCT),
} as const;

export type LookupType = keyof typeof LOOKUP_DATA;

export const LOOKUP_TYPES = Object.keys(LOOKUP_DATA) as LookupType[];
