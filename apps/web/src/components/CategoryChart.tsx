import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from '../api';
import { useTheme } from '../theme';

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export interface CategoryDatum {
  name: string;
  amount: number;
}

/**
 * Where the money went: one measure across categories, so a single hue with
 * direct value labels (top 8; the table below the chart has the full list).
 */
export function CategoryChart({ data }: { data: CategoryDatum[] }) {
  const t = useTheme();
  const top = data.slice(0, 8);
  const height = Math.max(120, top.length * 36 + 30);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={t.grid} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={compact}
          tick={{ fill: t.muted, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: t.axis }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fill: t.inkSecondary, fontSize: 13 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: t.grid, fillOpacity: 0.4 }}
          formatter={(v: number) => [fmtMoney(v), 'Spent']}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.grid}`,
            borderRadius: 8,
            color: t.inkPrimary,
            fontSize: 13,
          }}
        />
        <Bar dataKey="amount" fill={t.series[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList
            dataKey="amount"
            position="right"
            formatter={(v: number) => compact(v)}
            style={{ fill: t.inkSecondary, fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
