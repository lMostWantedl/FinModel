import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from '../api';
import { useTheme } from '../theme';
import type { MonthSummary } from '../types';

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/** Single-series debt-over-time area: no legend needed, the title names it. */
export function DebtTimelineChart({ timeline }: { timeline: MonthSummary[] }) {
  const t = useTheme();
  const blue = t.series[0]!;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={timeline} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: t.muted, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: t.axis }}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={compact}
          tick={{ fill: t.muted, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          cursor={{ stroke: t.axis, strokeDasharray: '3 3' }}
          formatter={(v: number) => [fmtMoney(v), 'Remaining debt']}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.grid}`,
            borderRadius: 8,
            color: t.inkPrimary,
            fontSize: 13,
          }}
        />
        <Area
          type="monotone"
          dataKey="totalClosing"
          stroke={blue}
          strokeWidth={2}
          fill={blue}
          fillOpacity={t.seriesFillAlpha}
          dot={false}
          activeDot={{ r: 4, stroke: t.surface, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
