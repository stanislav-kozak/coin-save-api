export function frankfurterOk(rates: Record<string, number>) {
  return { ok: true, status: 200, json: () => Promise.resolve({ rates }) };
}

export function secondaryOk(rates: Partial<Record<'UAH' | 'RUB', number>>) {
  const eur: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates)) {
    eur[code.toLowerCase()] = value;
  }
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ date: '2026-06-15', eur }),
  };
}

export function failing(status = 503) {
  return { ok: false, status };
}

export function mockFetch(routes: {
  frankfurter?: ReturnType<typeof frankfurterOk> | ReturnType<typeof failing>;
  jsdelivr?: ReturnType<typeof secondaryOk> | ReturnType<typeof failing>;
  cloudflare?: ReturnType<typeof secondaryOk> | ReturnType<typeof failing>;
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('frankfurter.dev')) {
      return Promise.resolve(routes.frankfurter ?? failing());
    }
    if (url.includes('jsdelivr.net')) {
      return Promise.resolve(routes.jsdelivr ?? failing());
    }
    if (url.includes('currency-api.pages.dev')) {
      return Promise.resolve(routes.cloudflare ?? failing());
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}
