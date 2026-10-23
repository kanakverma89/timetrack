// Hours arrive from the API as decimal strings ("7.50"). They are displayed as received and are
// never converted to floating point for arithmetic on the client.

const DECIMAL = /^\d+(\.\d{1,2})?$/;

export function formatHours(value: string): string {
  if (!DECIMAL.test(value)) return value;
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function isZeroHours(value: string): boolean {
  return /^0+(\.0+)?$/.test(value);
}
