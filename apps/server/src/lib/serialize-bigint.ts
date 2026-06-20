// Prisma may return BigInt for count/byte columns; JSON.stringify can't serialize
// BigInt natively. Serialize them as numbers. Imported once at process start.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: bigint) {
  return Number(this);
};

export {};
