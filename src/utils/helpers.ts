export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mean = (arr: number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

export const stdDev = (arr: number[]): number => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

export const formatMs = (ms: number): string => `${Math.round(ms)} ms`;

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
