import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from '../api';
import { strategySlot, useTheme } from '../theme';
import type { StrategyComparison } from '../types';

const LABELS: Record<string, string> = {
  current: 'Current',
  avalanche: 'Avalanche',
  snowball: 'Snowball',
  optimized: 'Optimized',
};

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/**
 * Total interest per strategy. Color follows the strategy (fixed slot per
 * entity); direct value labels satisfy the low-contrast relief rule.
 */
export function StrategyBarChart({ comparison }: { comparison: StrategyComparison[] }) {
  const t = useTheme();
  const data = comparison.map((c) => ({ ...c, label: LABELS[c.strategy] ?? c.strategy }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 24, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: t.inkSecondary, fontSize: 13 }}
          tickLine={false}
          axisLine={{ stroke: t.axis }}
        />
        <YAxis
          tickFormatter={compact}
          tick={{ fill: t.muted, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ fill: t.grid, fillOpacity: 0.4 }}
          formatter={(v: number) => [fmtMoney(v), 'Total interest']}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.grid}`,
            borderRadius: 8,
            color: t.inkPrimary,
            fontSize: 13,
          }}
        />
        <Bar dataKey="totalInterest" radius={[4, 4, 0, 0]} maxBarSize={64}>
          {data.map((row) => (
            <Cell key={row.strategy} fill={t.series[strategySlot[row.strategy] ?? 0]} />
          ))}
          <LabelList
            dataKey="totalInterest"
            position="top"
            formatter={(v: number) => compact(v)}
            style={{ fill: t.inkSecondary, fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
