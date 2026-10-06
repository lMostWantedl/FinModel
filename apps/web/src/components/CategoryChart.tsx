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

  // --- Detect Lend + Reimbursement pair and merge into a stacked bar ---
  let lendAmt = 0, reimbAmt = 0;
  const filtered: CategoryDatum[] = [];
  for (const d of data) {
    if (d.name === 'Lend') lendAmt += d.amount;
    else if (d.name === 'Reimbursement') reimbAmt += d.amount;
    else filtered.push(d);
  }

  const merged: CategoryDatum[] = [
    ...(lendAmt > 0 || reimbAmt > 0 ? [{ name: 'Lend & Reimbursement', amount: lendAmt + reimbAmt, lend: lendAmt, reimbursement: reimbAmt }] : []),
    ...filtered,
  ];

  const top = merged.slice(0, 8);
  // --- end merge ---

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
          formatter={(v: number, name: string, props?: any) => {
            if (name === 'Lend') return [fmtMoney(v), 'Lend'];
            if (name === 'Reimbursement') return [fmtMoney(v), 'Reimb.'];
            const payload = props?.payload;
            if (payload && (payload.lend != null || payload.reimbursement != null)) {
              return [`${fmtMoney(payload.lend)} / ${fmtMoney(payload.reimbursement)}`, 'L & R'];
            }
            return [fmtMoney(v), name];
          }}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.grid}`,
            borderRadius: 8,
            color: t.inkPrimary,
            fontSize: 13,
          }}
        />
        {/* Standard bar (for regular categories) */}
        {top[0]?.name !== 'Lend & Reimbursement' && (
          <Bar dataKey="amount" fill={t.series[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(v: number) => compact(v)}
              style={{ fill: t.inkSecondary, fontSize: 12 }}
            />
          </Bar>
        )}

        {/* Stacked bar for merged Lend + Reimbursement */}
        {top[0]?.name === 'Lend & Reimbursement' && (
          <>
            <Bar dataKey="reimbursement" stackId="a" fill={t.series[2]} radius={[0, 4, 4, 0]} maxBarSize={22} />
            <Bar dataKey="lend" stackId="a" fill={t.series[1]} radius={[0, 4, 4, 0]} maxBarSize={22}>
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(v: number) => compact(v)}
                style={{ fill: t.inkSecondary, fontSize: 12 }}
              />
            </Bar>
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
