// ECB reference currencies, served by api.frankfurter.dev.
export const FRANKFURTER_CURRENCIES = [
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

// Currencies the ECB doesn't publish. Served by a second provider
// (@fawazahmed0/currency-api) in CurrencyService, since they're mandatory
// for this app's target market.
export const SECONDARY_PROVIDER_CURRENCIES = ['UAH', 'RUB'] as const;

export const SUPPORTED_CURRENCIES = [
  ...FRANKFURTER_CURRENCIES,
  ...SECONDARY_PROVIDER_CURRENCIES,
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
