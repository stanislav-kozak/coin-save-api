export const SUPPORTED_CURRENCIES = [
  'UAH',
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
  'KZT',
  'MDL',
  'RON',
  'BGN',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
