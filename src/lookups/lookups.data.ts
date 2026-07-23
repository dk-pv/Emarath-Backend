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
  'EXCHANGE',
  'RETURN',
  'WRONG ITEM',
  'MISSING PRODUCT',
  'MISBEHAVIOR',
  'SOLVED',
  'UNSATISFIED',
  'DELIVERY DELAY',
  'REFUND ISSUE',
  'WRONG PRODUCT',
] as const;

/**
 * Product catalog (Phase 1 = names only, no Product entity). A representative
 * seed transcribed from the video's Product dropdown; the field stores the chosen
 * name. Phase 2 promotes this to a catalog entity if pricing/SKU is ever needed.
 */
const PRODUCT = [
  'MUKHALAT EMARATI',
  'MAQAM IBRAHIM',
  'QAMAR & KISMAT FRAGRANCE COMBO',
  'COLLECTION OF MOOD',
  'MIRAMAR COMBO',
  'HECTOR COMBO',
  'ASEEL PERFUME COMBO',
  'SHADOW FLAME PERFUME COMBO',
  'OLD MEMORIES PERFUME COMBO',
  'THE ARCHER COMBO',
  'JOVANO COMBO',
  'MYSTERY COMBO',
  'MOJIN COLLECTION PERFUME COMBO',
  'PEACOCK COLLECTION',
  'SEVEN DAYS',
  'ESENCE FLORAL COLLECTION',
  'LAROCHE COMBO',
  'TELLURIDE',
  'PINK BLACK',
  'PARIS RIVIERA',
  "OUD OF NO MEN'S LAND",
  'ORCHID IMPERIAL',
  'BRAZILIAN CRUSH',
  'GRIS DES VENTS',
  'ITALIAN CITRUS',
  'MOJAVE',
  'MOD NOIR',
  'AMEER AL ARAB 3-PIECE PERFUME SET',
  'AMBRE MAQUIS',
  'SUFI',
  'FERRAGAMO & SUFI COMBO',
  'CUPID FERRAGAMO',
  'BLUE SUFI',
  'SR SIGNATURE',
  'MANCERA RED TOBACCO',
  'CREED AVENTUS',
  'MFK BACCARAT ROUGE 540',
  'CK ETERNITY',
  'CREED SILVER MOUNTAIN WATER',
  'WHITE LACOSTE',
  'AMOUAGE INTERLUDE',
  'MISS DIOR CHERIE',
  'DOLCE & GABBANA LIGHT BLUE',
  'DOLCE & GABBANA THE ONE',
  'PACO RABANNE INVICTUS',
  'MONTBLANC LEGEND',
  'PACO RABANNE MILLION GOLDEN OUD',
  'ESCADA COLLECTION',
  'DOLCE & GABBANA VELVET DESERT OUD',
  'DIOR MIDNIGHT POISON',
  'CHRISTIAN DIOR FAHRENHEIT',
  'CHANEL COCO MADEMOISELLE',
  'CALVIN KLEIN CK ONE',
  'CHANEL ALLURE HOMME SPORT',
  'CHANEL ALLURE HOMME EDP',
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
  'ASTORIA WILD NIGHT',
  'JUST WARDI',
  'VELORA POP HEART',
  'VELORA SUGAR BLISS',
  'VELORA VIVA CHOCO',
  'TOBACCO INCENSE',
  'GUCCI POUR HOMME',
  'FENDI',
  'ESCADA SEXY GRAFFITI',
  'ESCADA SUNSET',
  'VERSACE CRYSTAL NOIR',
  'TOM FORD BLACK ORCHID',
  'ARBE PURO COMBO',
  'IVORY BLACK',
  'NASOMATTO BLACK',
  'HUGO BOSS',
  'XERJOFF ACCENTO',
  'MAISON FALCON COLLECTION',
  'LORENZO VILLORESI',
  "DIOR J'ADORE",
  'ICON ABSOLUTE ALFRED BY DUNHILL',
  'GUCCI GUILTY POUR HOMME',
  'ALFRED DUNHILL DESIRE RED',
  'VIVA CREAM',
  'BEAUTIFUL WEEKEND',
  'FURSAN AL LAIL',
  'OUD AL AMEER',
  'ZAFIRAH',
  'RANIA',
  'EJLAL',
  'CHERE BLOSSOM COMBO',
  'LA FLORAL COMBO',
  'PINK WAY',
  'LIFE ES BELLA',
  'FLORAL BLOOM',
  'EXCLUSIVE SIGNATURE PERFUME COMBO',
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
  'NAAH PISTACHIO',
  'OMBRA DE INTENSO',
  'RICARDO',
  'OPUS',
  'CHERIE PASSION',
  'JUICY BOMB',
  'OUD PRESTIGE',
  'IMPRESSO',
  'ROSES IN OUD NUIT',
  'ROSES IN OUD',
  'IMPERIAL LEGEND',
  'IMPERIAL',
  'CAVALIER GOLD',
  'CABRIQUE',
  'ORION',
  'MONTE CARLO',
  'INTENSE BROWN',
  'INTENSE BLACK',
  'LUCILE',
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
