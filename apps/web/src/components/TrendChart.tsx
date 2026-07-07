import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from '../api';
import { useTheme } from '../theme';
import type { SummaryBucket } from '../types';

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/** Income vs expense per period. Two fixed series colors; legend names them. */
export function TrendChart({ buckets }: { buckets: SummaryBucket[] }) {
  const t = useTheme();
  const income = t.series[1]!; // aqua (cool)
  const expense = t.series[7]!; // orange (warm) — clearly separable from income
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 0, left: 8 }} barGap={2}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="key"
          tick={{ fill: t.muted, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: t.axis }}
          minTickGap={24}
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
          formatter={(v: number, name: string) => [fmtMoney(v), name]}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.grid}`,
            borderRadius: 8,
            color: t.inkPrimary,
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 13, color: t.inkSecondary }} />
        <Bar dataKey="income" name="Income" fill={income} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" name="Expense" fill={expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
