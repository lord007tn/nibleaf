const MEBIBYTE = 1024n ** 2n;
const GIBIBYTE = 1024n ** 3n;

export const getByteQuantityParts = (quantity: string) => {
  const bytes = BigInt(quantity);
  const magnitude = bytes < 0n ? -bytes : bytes;
  const divisor = magnitude >= GIBIBYTE ? GIBIBYTE : magnitude >= MEBIBYTE ? MEBIBYTE : 1n;
  const whole = magnitude / divisor;
  return {
    whole: bytes < 0n ? -whole : whole,
    tenth: ((magnitude % divisor) * 10n) / divisor,
    unit: divisor === GIBIBYTE ? ('gib' as const) : divisor === MEBIBYTE ? ('mib' as const) : ('byte' as const),
  };
};

export const formatByteQuantity = (
  quantity: string,
  formatters: {
    number: (value: bigint) => string;
    decimal: (whole: string, fraction: string) => string;
    unit: (value: string, unit: 'byte' | 'mib' | 'gib') => string;
  },
) => {
  const { whole, tenth, unit } = getByteQuantityParts(quantity);
  const value = tenth === 0n ? formatters.number(whole) : formatters.decimal(formatters.number(whole), formatters.number(tenth));
  return formatters.unit(value, unit);
};
