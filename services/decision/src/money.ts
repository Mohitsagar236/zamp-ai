export const precisions: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
};
export function minor(value: string, currency: string): bigint {
  const p = precisions[currency];
  if (p === undefined) throw Error("Unsupported currency");
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(value)) throw Error("Invalid money value");
  const [whole, frac = ""] = value.split(".");
  if (frac.length > p && /[1-9]/.test(frac.slice(p)))
    throw Error(`Too many decimal places for ${currency}`);
  return (
    BigInt(whole) * 10n ** BigInt(p) +
    BigInt(frac.slice(0, p).padEnd(p, "0") || 0)
  );
}
export function amount(value: string | bigint, currency = "INR") {
  const p = precisions[currency] ?? 2;
  const n = BigInt(value);
  const sign = n < 0n ? "-" : "";
  const a = n < 0n ? -n : n;
  const whole = (a / 10n ** BigInt(p)).toString();
  const decimal = p
    ? "." + (a % 10n ** BigInt(p)).toString().padStart(p, "0")
    : "";
  return `${currency} ${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimal}`;
}
export const normalize = (s: string) =>
  s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
