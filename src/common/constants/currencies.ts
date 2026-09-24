// ECB reference currencies only (api.frankfurter.dev's provider). UAH, KZT,
// MDL, and BGN are not published by the ECB, so they were dropped from this
// whitelist for now. Re-add them once a second data source (e.g. NBU for
// UAH) is wired into CurrencyService.
export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'PLN',
  'CZK',
  'CHF',
  'CAD',
  'AUD',
  'JPY',
  'TRY',
  'RON',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
