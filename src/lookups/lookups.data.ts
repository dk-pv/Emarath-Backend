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
const LANGUAGE = [
  'Malayalam',
  'English',
  'Hindi',
  'Arabic',
  'Tamil',
  'Others',
] as const;

/**
 * The seed list for the `LeadSource` catalogue — no longer what the API serves.
 *
 * `GET /api/lookups/sources` reads the `lead_sources` table (the Settings screen manages
 * it), exactly as `categories` reads the `Category` table. This array remains the
 * deterministic set the seeds create, so a fresh database starts with the same sources
 * it always did; editing it changes what is seeded, not what the API returns.
 */
export const SOURCE = [
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
/**
 * The Leads list "Activity" filter (and the ownership report's Contacted / No Activity
 * drill-downs): the two engagement states `lead-engagement-where.ts` defines.
 */
const LEAD_ACTIVITY = ['Contacted', 'No Activity'];

/**
 * Why a lead was lost (RPT-02.7 v2) — offered when a lead is moved to LOST and grouped by
 * the Lost Leads report. Business-editable here, like every config catalogue.
 */
const LOST_REASON = [
  'Price too high',
  'Chose competitor',
  'No budget',
  'Not interested',
  'Unresponsive',
  'Wrong / invalid number',
  'Duplicate',
  'Other',
];

/**
 * The currency catalogue the Organization → General Settings screen offers, transcribed
 * from the Workpex reference list. The value is the ISO-style code the setting stores;
 * the label is what the reference prints, symbol included.
 *
 * A lookup rather than a constant duplicated on both sides: the settings DTO validates
 * the saved code against this array and the screen reads the same list through
 * `GET /api/lookups/currencies`, so the offered options and the accepted values cannot
 * drift.
 */
export const CURRENCIES = [
  { value: 'AFN', label: 'AFN - Afghan afghani (؋)' },
  { value: 'EUR', label: 'EUR - Euro (€)' },
  { value: 'ALL', label: 'ALL - Albanian lek (Lek)' },
  { value: 'DZD', label: 'DZD - Algerian dinar (دج)' },
  { value: 'USD', label: 'USD - US Dollar ($)' },
  { value: 'AOA', label: 'AOA - Angolan kwanza (Kz)' },
  { value: 'XCD', label: 'XCD - East Caribbean dollar ($)' },
  { value: 'AAD', label: 'AAD - Antarctican dollar ($)' },
  { value: 'ARS', label: 'ARS - Argentine peso ($)' },
  { value: 'AMD', label: 'AMD - Armenian dram (֏)' },
  { value: 'AWG', label: 'AWG - Aruban florin (ƒ)' },
  { value: 'AUD', label: 'AUD - Australian dollar ($)' },
  { value: 'AZN', label: 'AZN - Azerbaijani manat (m)' },
  { value: 'BHD', label: 'BHD - Bahraini dinar (.د.ب)' },
  { value: 'BDT', label: 'BDT - Bangladeshi taka (৳)' },
  { value: 'BBD', label: 'BBD - Barbadian dollar (Bds$)' },
  { value: 'BYN', label: 'BYN - Belarusian ruble (Br)' },
  { value: 'BZD', label: 'BZD - Belize dollar ($)' },
  { value: 'XOF', label: 'XOF - West African CFA franc (CFA)' },
  { value: 'BMD', label: 'BMD - Bermudian dollar ($)' },
  { value: 'BTN', label: 'BTN - Bhutanese ngultrum (Nu.)' },
  { value: 'BOB', label: 'BOB - Bolivian boliviano (Bs.)' },
  { value: 'BAM', label: 'BAM - Bosnia and Herzegovina convertible mark' },
  { value: 'BWP', label: 'BWP - Botswana pula (P)' },
  { value: 'NOK', label: 'NOK - Norwegian Krone (kr)' },
  { value: 'BRL', label: 'BRL - Brazilian real (R$)' },
  { value: 'BND', label: 'BND - Brunei dollar (B$)' },
  { value: 'BGN', label: 'BGN - Bulgarian lev (Лв.)' },
  { value: 'BIF', label: 'BIF - Burundian franc (FBu)' },
  { value: 'KHR', label: 'KHR - Cambodian riel (KHR)' },
  { value: 'XAF', label: 'XAF - Central African CFA franc' },
  { value: 'CAD', label: 'CAD - Canadian dollar ($)' },
  { value: 'CVE', label: 'CVE - Cape Verdean escudo ($)' },
  { value: 'KYD', label: 'KYD - Cayman Islands dollar ($)' },
  { value: 'CLP', label: 'CLP - Chilean peso ($)' },
  { value: 'CNY', label: 'CNY - Chinese yuan (¥)' },
  { value: 'COP', label: 'COP - Colombian peso ($)' },
  { value: 'KMF', label: 'KMF - Comorian franc (CF)' },
  { value: 'NZD', label: 'NZD - Cook Islands dollar ($)' },
  { value: 'CRC', label: 'CRC - Costa Rican colón (₡)' },
  { value: 'HRK', label: 'HRK - Croatian kuna (kn)' },
  { value: 'CUP', label: 'CUP - Cuban peso ($)' },
  { value: 'ANG', label: 'ANG - Netherlands Antillean guilder' },
  { value: 'CZK', label: 'CZK - Czech koruna (Kč)' },
  { value: 'CDF', label: 'CDF - Congolese Franc (FC)' },
  { value: 'DKK', label: 'DKK - Danish krone (Kr.)' },
  { value: 'DJF', label: 'DJF - Djiboutian franc (Fdj)' },
  { value: 'DOP', label: 'DOP - Dominican peso ($)' },
  { value: 'EGP', label: 'EGP - Egyptian pound (ج.م)' },
  { value: 'ERN', label: 'ERN - Eritrean nakfa (Nfk)' },
  { value: 'SZL', label: 'SZL - Lilangeni (E)' },
  { value: 'ETB', label: 'ETB - Ethiopian birr (Nkf)' },
  { value: 'FKP', label: 'FKP - Falkland Islands pound (£)' },
  { value: 'FJD', label: 'FJD - Fijian dollar (FJ$)' },
  { value: 'XPF', label: 'XPF - CFP franc (₣)' },
  { value: 'GMD', label: 'GMD - Gambian dalasi (D)' },
  { value: 'GEL', label: 'GEL - Georgian lari (ლ)' },
  { value: 'GHS', label: 'GHS - Ghanaian cedi (GH₵)' },
  { value: 'GIP', label: 'GIP - Gibraltar pound (£)' },
  { value: 'GTQ', label: 'GTQ - Guatemalan quetzal (Q)' },
  { value: 'GBP', label: 'GBP - British pound (£)' },
  { value: 'GNF', label: 'GNF - Guinean franc (FG)' },
  { value: 'GYD', label: 'GYD - Guyanese dollar ($)' },
  { value: 'HTG', label: 'HTG - Haitian gourde (G)' },
  { value: 'HNL', label: 'HNL - Honduran lempira (L)' },
  { value: 'HKD', label: 'HKD - Hong Kong dollar ($)' },
  { value: 'HUF', label: 'HUF - Hungarian forint (Ft)' },
  { value: 'ISK', label: 'ISK - Icelandic króna (kr)' },
  { value: 'INR', label: 'INR - Indian rupee (₹)' },
  { value: 'IDR', label: 'IDR - Indonesian rupiah (Rp)' },
  { value: 'IRR', label: 'IRR - Iranian rial (﷼)' },
  { value: 'IQD', label: 'IQD - Iraqi dinar (د.ع)' },
  { value: 'ILS', label: 'ILS - Israeli new shekel (₪)' },
  { value: 'JMD', label: 'JMD - Jamaican dollar (J$)' },
  { value: 'JPY', label: 'JPY - Japanese yen (¥)' },
  { value: 'JOD', label: 'JOD - Jordanian dinar (ا.د)' },
  { value: 'KZT', label: 'KZT - Kazakhstani tenge (лв)' },
  { value: 'KES', label: 'KES - Kenyan shilling (KSh)' },
  { value: 'KWD', label: 'KWD - Kuwaiti dinar (ك.د)' },
  { value: 'KGS', label: 'KGS - Kyrgyzstani som (лв)' },
  { value: 'LAK', label: 'LAK - Lao kip (₭)' },
  { value: 'LBP', label: 'LBP - Lebanese pound (£)' },
  { value: 'LSL', label: 'LSL - Lesotho loti (L)' },
  { value: 'LRD', label: 'LRD - Liberian dollar ($)' },
  { value: 'LYD', label: 'LYD - Libyan dinar (د.ل)' },
  { value: 'CHF', label: 'CHF - Swiss franc (CHf)' },
  { value: 'MOP', label: 'MOP - Macanese pataca ($)' },
  { value: 'MGA', label: 'MGA - Malagasy ariary (Ar)' },
  { value: 'MWK', label: 'MWK - Malawian kwacha (MK)' },
  { value: 'MYR', label: 'MYR - Malaysian ringgit (RM)' },
  { value: 'MVR', label: 'MVR - Maldivian rufiyaa (Rf)' },
  { value: 'MRO', label: 'MRO - Mauritanian ouguiya (MRU)' },
  { value: 'MUR', label: 'MUR - Mauritian rupee (₨)' },
  { value: 'MXN', label: 'MXN - Mexican peso ($)' },
  { value: 'MDL', label: 'MDL - Moldovan leu (L)' },
  { value: 'MNT', label: 'MNT - Mongolian tögrög (₮)' },
  { value: 'MAD', label: 'MAD - Moroccan dirham (DH)' },
  { value: 'MZN', label: 'MZN - Mozambican metical (MT)' },
  { value: 'MMK', label: 'MMK - Burmese kyat (K)' },
  { value: 'NAD', label: 'NAD - Namibian dollar ($)' },
  { value: 'NPR', label: 'NPR - Nepalese rupee (₨)' },
  { value: 'NIO', label: 'NIO - Nicaraguan córdoba (C$)' },
  { value: 'NGN', label: 'NGN - Nigerian naira (₦)' },
  { value: 'KPW', label: 'KPW - North Korean Won (₩)' },
  { value: 'MKD', label: 'MKD - Denar (ден)' },
  { value: 'OMR', label: 'OMR - Omani rial (.ع.ر)' },
  { value: 'PKR', label: 'PKR - Pakistani rupee (₨)' },
  { value: 'PAB', label: 'PAB - Panamanian balboa (B/.)' },
  { value: 'PGK', label: 'PGK - Papua New Guinean kina (K)' },
  { value: 'PYG', label: 'PYG - Paraguayan guarani (₲)' },
  { value: 'PEN', label: 'PEN - Peruvian sol (S/.)' },
  { value: 'PHP', label: 'PHP - Philippine peso (₱)' },
  { value: 'PLN', label: 'PLN - Polish złoty (zł)' },
  { value: 'QAR', label: 'QAR - Qatari riyal (ق.ر)' },
  { value: 'RON', label: 'RON - Romanian leu (lei)' },
  { value: 'RUB', label: 'RUB - Russian ruble (₽)' },
  { value: 'RWF', label: 'RWF - Rwandan franc (FRw)' },
  { value: 'SHP', label: 'SHP - Saint Helena pound (£)' },
  { value: 'WST', label: 'WST - Samoan tālā (SAT)' },
  { value: 'STD', label: 'STD - Dobra (Db)' },
  { value: 'SAR', label: 'SAR - Saudi riyal (﷼)' },
  { value: 'RSD', label: 'RSD - Serbian dinar (din)' },
  { value: 'SCR', label: 'SCR - Seychellois rupee (SRe)' },
  { value: 'SLL', label: 'SLL - Sierra Leonean leone (Le)' },
  { value: 'SGD', label: 'SGD - Singapore dollar ($)' },
  { value: 'SBD', label: 'SBD - Solomon Islands dollar (Si$)' },
  { value: 'SOS', label: 'SOS - Somali shilling (Sh.so.)' },
  { value: 'ZAR', label: 'ZAR - South African rand (R)' },
  { value: 'KRW', label: 'KRW - Won (₩)' },
  { value: 'SSP', label: 'SSP - South Sudanese pound (£)' },
  { value: 'LKR', label: 'LKR - Sri Lankan rupee (Rs)' },
  { value: 'SDG', label: 'SDG - Sudanese pound (.س.ج)' },
  { value: 'SRD', label: 'SRD - Surinamese dollar ($)' },
  { value: 'SEK', label: 'SEK - Swedish krona (kr)' },
  { value: 'SYP', label: 'SYP - Syrian pound (LS)' },
  { value: 'TWD', label: 'TWD - New Taiwan dollar ($)' },
  { value: 'TJS', label: 'TJS - Tajikistani somoni (SM)' },
  { value: 'TZS', label: 'TZS - Tanzanian shilling (TSh)' },
  { value: 'THB', label: 'THB - Thai baht (฿)' },
  { value: 'BSD', label: 'BSD - Bahamian dollar (B$)' },
  { value: 'TOP', label: 'TOP - Tongan paʻanga ($)' },
  { value: 'TTD', label: 'TTD - Trinidad and Tobago dollar' },
  { value: 'TND', label: 'TND - Tunisian dinar (ت.د)' },
  { value: 'TRY', label: 'TRY - Turkish lira (₺)' },
  { value: 'TMT', label: 'TMT - Turkmenistan manat (T)' },
  { value: 'UGX', label: 'UGX - Ugandan shilling (USh)' },
  { value: 'UAH', label: 'UAH - Ukrainian hryvnia (₴)' },
  { value: 'AED', label: 'AED - United Arab Emirates dirham' },
  { value: 'UYU', label: 'UYU - Uruguayan peso ($)' },
  { value: 'UZS', label: 'UZS - Uzbekistani soʻm (лв)' },
  { value: 'VUV', label: 'VUV - Vanuatu vatu (VT)' },
  { value: 'VES', label: 'VES - Bolívar (Bs)' },
  { value: 'VND', label: 'VND - Vietnamese đồng (₫)' },
  { value: 'YER', label: 'YER - Yemeni rial (﷼)' },
  { value: 'ZMW', label: 'ZMW - Zambian kwacha (ZK)' },
  { value: 'ZWL', label: 'ZWL - Zimbabwe Dollar ($)' },
] as const;

export const CURRENCY_CODES: readonly string[] = CURRENCIES.map((c) => c.value);

export const LOOKUP_DATA = {
  languages: options(LANGUAGE),
  /** Organization → General Settings' Currency field. */
  currencies: CURRENCIES.map((c) => ({ value: c.value, label: c.label })),
  /** Seed/dev-dataset only; the live list comes from the catalogue (see `SOURCE`). */
  sources: options(SOURCE),
  callStatus: options(CALL_STATUS),
  attemptCounts: options(ATTEMPT_COUNT),
  paymentMethods: options(PAYMENT_METHOD),
  complaintReasons: options(COMPLAINT_REASON),
  products: options(PRODUCT),
  leadActivity: options(LEAD_ACTIVITY),
  lostReasons: options(LOST_REASON),
} as const;

export type LookupType = keyof typeof LOOKUP_DATA;

export const LOOKUP_TYPES = Object.keys(LOOKUP_DATA) as LookupType[];
