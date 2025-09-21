export const adjustQuantity = (qty: number, step: number) => {
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  const adjusted = Math.floor(qty / step) * step;
  return parseFloat(adjusted.toFixed(precision));
};

// Tasa de comisión de Binance (0.1%)
export const BINANCE_FEE_RATE = 0.001;