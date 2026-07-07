import { useEffect, useState } from 'react';

/**
 * Validated dataviz palette (light and dark are separately selected steps of
 * the same hues, not an automatic flip). Categorical slots are assigned in
 * fixed order, never cycled.
 */
const light = {
  surface: '#fcfcfb',
  page: '#f9f9f7',
  inkPrimary: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'],
  seriesFillAlpha: 0.18,
  good: '#006300',
  critical: '#d03b3b',
};

const dark: typeof light = {
  surface: '#1a1a19',
  page: '#0d0d0d',
  inkPrimary: '#ffffff',
  inkSecondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'],
  seriesFillAlpha: 0.25,
  good: '#0ca30c',
  critical: '#d03b3b',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const query = '(prefers-color-scheme: dark)';
  const [isDark, setIsDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDark ? dark : light;
}

/** Fixed color per strategy: color follows the entity, never its rank. */
export const strategySlot: Record<string, number> = {
  current: 0,
  avalanche: 1,
  snowball: 2,
  optimized: 3,
};
