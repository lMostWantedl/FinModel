import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtMoney } from '../api';
import { useTheme } from '../theme';
import type { LoanAnalyticsItem, LoanAnalyticsResponse } from '../types';

const compact = (v: number) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export interface LoanChartsProps {
  data: LoanAnalyticsResponse;
  onRecalculate?: () => void;
  recalculating?: boolean;
}

type SortField = 'outstanding' | 'paid' | 'toBePaid' | 'rate' | 'percent';

export function LoanCharts({ data, onRecalculate, recalculating }: LoanChartsProps) {
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'grouped' | 'stacked'>('grouped');
  const [sortBy, setSortBy] = useState<SortField>('outstanding');
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  const { summary, loans } = data;

  // Sorting
  const sortedLoans = [...loans].sort((a, b) => {
    switch (sortBy) {
      case 'outstanding':
        return b.outstandingAmount - a.outstandingAmount;
      case 'paid':
        return b.amountPaid - a.amountPaid;
      case 'toBePaid':
        return b.amountToBePaid - a.amountToBePaid;
      case 'rate':
        return (b.apr || b.annualInterestRate) - (a.apr || a.annualInterestRate);
      case 'percent':
        return b.percentPaid - a.percentPaid;
      default:
        return 0;
    }
  });

  // Chart 1 dataset: Main comparison
  const barChartData = sortedLoans.map((l) => ({
    id: l.id,
    name: l.name,
    lender: l.lender,
    outstanding: l.outstandingAmount,
    paid: l.amountPaid,
    principalPaid: l.principalPaidSoFar,
    toBePaid: l.amountToBePaid,
    remainingInterest: l.remainingInterest,
    percentPaid: l.percentPaid || l.principalPercentPaid,
    rate: l.annualInterestRate,
    emi: l.emi,
    statementPaid: l.statementPaid2026,
    statementCount: l.statementTxnCount2026,
  }));

  // Pie chart datasets
  const outstandingPieData = loans.map((l, idx) => ({
    name: l.name,
    lender: l.lender,
    value: l.outstandingAmount,
    color: t.series[idx % t.series.length]!,
  }));

  const emiPieData = loans.map((l, idx) => ({
    name: l.name,
    lender: l.lender,
    value: l.emi,
    color: t.series[idx % t.series.length]!,
  }));

  // Color assignments
  const colorPaid = t.series[1]!; // Green (#199e70 / #1baf7a)
  const colorOutstanding = t.series[0]!; // Blue (#3987e5 / #2a78d6)
  const colorToBePaid = t.series[2]!; // Amber (#c98500 / #eda100)
  const colorInterest = t.series[5]!; // Coral/Red (#e66767 / #e34948)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 1. Summary KPI Tiles */}
      <div className="tiles" style={{ margin: 0 }}>
        <div className="tile">
          <div className="label">Current Outstanding</div>
          <div className="value" style={{ color: colorOutstanding }}>
            {fmtMoney(summary.totalOutstanding)}
          </div>
          <div className="sub">{summary.loanCount} active loans</div>
        </div>

        <div className="tile">
          <div className="label">Principal Repaid So Far</div>
          <div className="value" style={{ color: colorPaid }}>
            {fmtMoney(summary.totalPrincipalPaid)}
          </div>
          <div className="sub">
            <span
              style={{
                display: 'inline-block',
                background: `${colorPaid}22`,
                color: colorPaid,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: 4,
                marginRight: 6,
              }}
            >
              {summary.totalLoanAmount > 0
                ? Math.round((summary.totalPrincipalPaid / summary.totalLoanAmount) * 1000) / 10
                : 0}
              %
            </span>
            of {fmtMoney(summary.totalLoanAmount)} borrowed
          </div>
        </div>

        <div className="tile">
          <div className="label">Amount To Be Paid</div>
          <div className="value" style={{ color: colorToBePaid }}>
            {fmtMoney(summary.totalAmountToBePaid)}
          </div>
          <div className="sub">
            future EMIs (incl. {fmtMoney(summary.totalRemainingInterest)} interest)
          </div>
        </div>

        <div className="tile">
          <div className="label">Monthly EMI Burden</div>
          <div className="value">{fmtMoney(summary.totalMonthlyEmi)}</div>
          <div className="sub">monthly cash outflow</div>
        </div>

        <div className="tile">
          <div className="label">2026 Statement Paid</div>
          <div className="value" style={{ color: 'var(--accent)' }}>
            {fmtMoney(summary.totalStatementPaid2026)}
          </div>
          <div className="sub">
            {summary.totalStatementTxnCount2026} verified debits in 2026
          </div>
        </div>
      </div>

      {/* 2. Main Chart: Per-Loan Debt Triad */}
      <div className="card" style={{ margin: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Loan Debt Status: Outstanding vs. Paid vs. To Be Paid</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Compare current principal balance, what you have paid off, and future payments remaining for each loan.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, background: 'var(--page)', padding: 3, borderRadius: 8 }}>
              <button
                className="ghost"
                style={{
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: viewMode === 'grouped' ? 600 : 400,
                  background: viewMode === 'grouped' ? 'var(--surface-1)' : 'transparent',
                  color: viewMode === 'grouped' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: viewMode === 'grouped' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => setViewMode('grouped')}
              >
                Side-by-Side
              </button>
              <button
                className="ghost"
                style={{
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: viewMode === 'stacked' ? 600 : 400,
                  background: viewMode === 'stacked' ? 'var(--surface-1)' : 'transparent',
                  color: viewMode === 'stacked' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: viewMode === 'stacked' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
                onClick={() => setViewMode('stacked')}
              >
                Stacked Obligation
              </button>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              style={{ fontSize: 12, padding: '4px 8px' }}
            >
              <option value="outstanding">Sort: Outstanding (High to Low)</option>
              <option value="paid">Sort: Amount Paid (High to Low)</option>
              <option value="toBePaid">Sort: Amount To Be Paid (High to Low)</option>
              <option value="percent">Sort: % Progress (High to Low)</option>
              <option value="rate">Sort: Interest Rate (Highest first)</option>
            </select>

            {onRecalculate && (
              <button
                className="ghost"
                disabled={recalculating}
                onClick={onRecalculate}
                style={{
                  border: '1px solid var(--border)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-1)',
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  cursor: recalculating ? 'wait' : 'pointer',
                }}
                title="Redo all calculations by reconciling verified statement payments with loan schedules"
              >
                <span
                  style={{
                    display: 'inline-block',
                    transform: recalculating ? 'rotate(360deg)' : 'none',
                    transition: 'transform 0.5s linear',
                  }}
                >
                  ↻
                </span>
                {recalculating ? 'Recalculating...' : 'Redo Calculations'}
              </button>
            )}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={barChartData} margin={{ top: 12, right: 12, bottom: 20, left: 10 }}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: t.inkSecondary, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: t.axis }}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tickFormatter={compact}
              tick={{ fill: t.muted, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={54}
            />
            <Tooltip
              cursor={{ fill: t.grid, fillOpacity: 0.3 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload as (typeof barChartData)[0];
                return (
                  <div
                    style={{
                      background: t.surface,
                      border: `1px solid ${t.grid}`,
                      borderRadius: 8,
                      padding: '10px 14px',
                      color: t.inkPrimary,
                      fontSize: 13,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      minWidth: 200,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 11, color: t.muted, marginBottom: 8 }}>
                      {d.lender} · {d.rate}% p.a.
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                      <span style={{ color: colorOutstanding }}>Current Outstanding:</span>
                      <strong>{fmtMoney(d.outstanding)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                      <span style={{ color: colorPaid }}>
                        {d.paid > 0 ? 'Contract Repaid:' : d.principalPaid > 0 ? 'Principal Repaid:' : 'Amount Paid:'}
                      </span>
                      <strong>{fmtMoney(d.paid || d.principalPaid)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                      <span style={{ color: colorToBePaid }}>Scheduled To Be Paid:</span>
                      <strong>{fmtMoney(d.toBePaid)}</strong>
                    </div>
                    {d.statementPaid > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                        <span style={{ color: 'var(--accent)' }}>2026 Statement Debits:</span>
                        <strong style={{ color: 'var(--accent)' }}>
                          {fmtMoney(d.statementPaid)} ({d.statementCount} debits)
                        </strong>
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: `1px solid ${t.grid}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ color: t.muted }}>Contract Progress:</span>
                      <strong style={{ color: colorPaid }}>{d.percentPaid}%</strong>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ fontSize: 12, paddingBottom: 10 }}
            />
            {viewMode === 'grouped' ? (
              <>
                <Bar dataKey="outstanding" name="Current Outstanding" fill={colorOutstanding} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="paid" name="Amount Paid" fill={colorPaid} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="toBePaid" name="Amount To Be Paid" fill={colorToBePaid} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </>
            ) : (
              <>
                <Bar dataKey="paid" name="Amount Paid" stackId="a" fill={colorPaid} maxBarSize={48} />
                <Bar dataKey="outstanding" name="Current Outstanding (Principal)" stackId="a" fill={colorOutstanding} maxBarSize={48} />
                <Bar dataKey="remainingInterest" name="Future Interest Remaining" stackId="a" fill={colorInterest} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 3. Distribution Donut Charts: Outstanding vs Monthly EMI Burden */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Donut 1: Current Outstanding Balance Share */}
        <div className="card" style={{ margin: 0 }}>
          <h2>Current Debt Distribution (% of Outstanding)</h2>
          <p className="muted" style={{ margin: '-8px 0 12px', fontSize: 12.5 }}>
            Total: {fmtMoney(summary.totalOutstanding)} across {summary.loanCount} lenders
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={outstandingPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
              >
                {outstandingPieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(val: number, name: string) => [
                  `${fmtMoney(val)} (${Math.round((val / summary.totalOutstanding) * 100)}%)`,
                  name,
                ]}
                contentStyle={{
                  background: t.surface,
                  border: `1px solid ${t.grid}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              justifyContent: 'center',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {outstandingPieData.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                <span style={{ color: t.inkSecondary }}>{item.name}:</span>
                <strong>{Math.round((item.value / summary.totalOutstanding) * 100)}%</strong>
              </div>
            ))}
          </div>
        </div>

        {/* Donut 2: Monthly EMI Burden Share */}
        <div className="card" style={{ margin: 0 }}>
          <h2>Monthly EMI Outflow Share</h2>
          <p className="muted" style={{ margin: '-8px 0 12px', fontSize: 12.5 }}>
            Total: {fmtMoney(summary.totalMonthlyEmi)} due every month
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={emiPieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
              >
                {emiPieData.map((entry, index) => (
                  <Cell key={`cell-emi-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(val: number, name: string) => [
                  `${fmtMoney(val)}/mo (${Math.round((val / summary.totalMonthlyEmi) * 100)}%)`,
                  name,
                ]}
                contentStyle={{
                  background: t.surface,
                  border: `1px solid ${t.grid}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              justifyContent: 'center',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {emiPieData.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                <span style={{ color: t.inkSecondary }}>{item.name}:</span>
                <strong>{fmtMoney(item.value)}/mo</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Chart 3: Cost of Debt & Interest Rate Ranking */}
      <div className="card" style={{ margin: 0 }}>
        <h2>Cost of Borrowing: Interest Rate (APR %) Comparison</h2>
        <p className="muted" style={{ margin: '-8px 0 16px', fontSize: 12.5 }}>
          High-interest loans drain the most money. Prioritize clearing loans with rates &gt; 25% first (Avalanche method).
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={[...loans].sort((a, b) => (b.apr || b.annualInterestRate) - (a.apr || a.annualInterestRate))}
            layout="vertical"
            margin={{ top: 4, right: 30, bottom: 4, left: 120 }}
          >
            <CartesianGrid stroke={t.grid} horizontal={false} />
            <XAxis
              type="number"
              unit="%"
              tick={{ fill: t.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: t.axis }}
              domain={[0, 'dataMax + 5']}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: t.inkSecondary, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={110}
            />
            <Tooltip
              formatter={(val: number) => [`${val}% p.a.`, 'Annual Interest Rate']}
              contentStyle={{
                background: t.surface,
                border: `1px solid ${t.grid}`,
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="annualInterestRate" radius={[0, 4, 4, 0]} maxBarSize={20}>
              {loans.map((l, index) => {
                const rate = l.apr || l.annualInterestRate;
                const fill = rate >= 30 ? 'var(--critical)' : rate >= 22 ? colorToBePaid : colorPaid;
                return <Cell key={`rate-${index}`} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 5. Detailed Per-Loan Visual Progress Cards */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Per-Loan Repayment Cards (Loan Contract Data)</h2>
            <p className="muted" style={{ margin: '3px 0 0', fontSize: 12.5 }}>
              Calculated from official loan contract details: sanctioned amount, outstanding principal, and scheduled EMIs.
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {loans.map((loan) => {
            const isSelected = selectedLoanId === loan.id;
            const effectiveElapsed = Math.max(loan.elapsedMonths, loan.statementTxnCount2026);
            const effectiveRemaining = loan.tenureMonths > 0 ? Math.max(0, loan.tenureMonths - effectiveElapsed) : loan.remainingMonths;
            const isMidway = effectiveElapsed > 0;
            const isPrincipalReduced = loan.principalPaidSoFar > 0;
            const progress =
              loan.percentPaid > 0
                ? loan.percentPaid
                : effectiveElapsed > 0 && loan.tenureMonths > 0
                  ? Math.round((effectiveElapsed / loan.tenureMonths) * 1000) / 10
                  : loan.principalPercentPaid;

            let badgeText = `${effectiveRemaining} mos remaining`;
            if (isMidway && loan.tenureMonths > 0) {
              badgeText = `${effectiveElapsed} of ${loan.tenureMonths} EMIs paid (${progress}%)`;
            } else if (isPrincipalReduced) {
              badgeText = `₹${compact(loan.principalPaidSoFar)} principal repaid (${loan.principalPercentPaid}%)`;
            } else if (loan.tenureMonths > 0) {
              badgeText = `Active · ${effectiveRemaining} mos remaining`;
            }

            return (
              <div
                key={loan.id}
                className="card"
                style={{
                  margin: 0,
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                  transition: 'all 0.15s ease-in-out',
                }}
                onClick={() => setSelectedLoanId(isSelected ? null : loan.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{loan.name}</h3>
                    <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
                      {loan.lender} · {loan.type.toLowerCase()}
                    </div>
                  </div>
                  <span
                    className="badge"
                    style={{
                      background: progress >= 50 ? `${colorPaid}20` : 'var(--border)',
                      color: progress >= 50 ? colorPaid : 'inherit',
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {badgeText}
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: 7,
                    background: 'var(--grid)',
                    borderRadius: 999,
                    overflow: 'hidden',
                    marginBottom: 14,
                    display: 'flex',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, progress))}%`,
                      background: progress > 0 ? colorPaid : 'transparent',
                      borderRadius: 999,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                {/* 3 Metrics: Outstanding, Repaid to date, To Be Paid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    background: 'var(--page)',
                    padding: '10px 12px',
                    borderRadius: 8,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: t.muted }}>Outstanding</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colorOutstanding, marginTop: 2 }}>
                      {fmtMoney(loan.outstandingAmount)}
                    </div>
                    <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>Principal balance</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: t.muted }}>
                      {loan.contractualPaid > 0 ? 'Contract Repaid' : loan.principalPaidSoFar > 0 ? 'Principal Repaid' : 'Amount Paid'}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colorPaid, marginTop: 2 }}>
                      {fmtMoney(loan.contractualPaid || (effectiveElapsed * loan.emi) || loan.statementPaid2026 || loan.principalPaidSoFar)}
                    </div>
                    <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>
                      {effectiveElapsed > 0 ? `${effectiveElapsed} EMIs completed` : loan.principalPaidSoFar > 0 ? `${loan.principalPercentPaid}% repaid` : '0 EMIs elapsed'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: t.muted }}>To Be Paid</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colorToBePaid, marginTop: 2 }}>
                      {fmtMoney(
                        effectiveRemaining > 0 && (loan.amountToBePaid === loan.tenureMonths * loan.emi || loan.amountToBePaid === 0)
                          ? effectiveRemaining * loan.emi
                          : loan.amountToBePaid,
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>
                      {effectiveRemaining} EMIs left
                    </div>
                  </div>
                </div>

                {/* Details list */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.inkSecondary }}>
                  <span>
                    EMI: <strong>{fmtMoney(loan.emi)}</strong> (due {loan.emiDay}th)
                  </span>
                  <span>
                    Rate: <strong>{loan.annualInterestRate}%</strong>
                  </span>
                  <span>
                    Sanctioned: <strong>{fmtMoney(loan.loanAmount)}</strong>
                  </span>
                </div>

                {loan.statementPaid2026 > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: '1px solid var(--border)',
                      fontSize: 11.5,
                      color: t.muted,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>2026 Statements:</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
                      {loan.statementTxnCount2026} debits reconciled ({fmtMoney(loan.statementPaid2026)})
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. Dedicated Section: 2026 Bank Statement Reconciled Payments */}
      <div className="card" style={{ margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0 }}>2026 Bank Statement Payments (Reconciled since Jan 1, 2026)</h2>
              <span
                className="badge"
                style={{
                  background: 'rgba(57, 135, 229, 0.15)',
                  color: 'var(--accent)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                2026 Statements
              </span>
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5 }}>
              Bank statement records were imported starting from <strong>Jan 1, 2026</strong>. The figures below reflect verified automated debits (ACH / NACH / UPI e-mandates) during 2026. Because older loans originated before 2026, lifetime repayment progress and principal balances above are tracked from official loan contracts.
            </p>
          </div>
        </div>

        {/* Statement summary strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            background: 'var(--page)',
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 11.5, color: t.muted }}>Total 2026 Statement Repayments</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>
              {fmtMoney(summary.totalStatementPaid2026)}
            </div>
            <div style={{ fontSize: 11.5, color: t.muted }}>verified debits across all loans</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: t.muted }}>Reconciled Transactions</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
              {summary.totalStatementTxnCount2026} debits
            </div>
            <div style={{ fontSize: 11.5, color: t.muted }}>automated e-mandates matched</div>
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: t.muted }}>Statement Date Range</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
              {summary.statementStartDate ?? '2026-01-01'} to {summary.statementEndDate ?? 'Present'}
            </div>
            <div style={{ fontSize: 11.5, color: t.muted }}>active verification window</div>
          </div>
        </div>

        {/* Table of per-loan 2026 debits */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>Loan &amp; Lender</th>
                <th className="num">Scheduled EMI</th>
                <th className="num">2026 Debits Verified</th>
                <th className="num">2026 Reconciled Total</th>
                <th className="num">Est. Months in 2026</th>
                <th>Latest Debit Verified</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => {
                const estMonths = l.emi > 0 ? Math.round((l.statementPaid2026 / l.emi) * 10) / 10 : 0;
                return (
                  <tr key={`stmt-${l.id}`}>
                    <td>
                      <strong>{l.name}</strong>
                      <div style={{ fontSize: 11.5, color: t.muted }}>{l.lender}</div>
                    </td>
                    <td className="num">{fmtMoney(l.emi)}</td>
                    <td className="num">
                      <strong>{l.statementTxnCount2026}</strong> debits
                    </td>
                    <td className="num" style={{ color: colorPaid, fontWeight: 600 }}>
                      {fmtMoney(l.statementPaid2026)}
                    </td>
                    <td className="num">
                      {estMonths > 0 ? `~${estMonths} mos` : '—'}
                    </td>
                    <td style={{ color: t.inkSecondary, fontSize: 12 }}>
                      {l.lastPaymentDate ?? '—'}
                    </td>
                    <td>
                      {l.statementTxnCount2026 > 0 ? (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(25, 158, 112, 0.15)',
                            color: colorPaid,
                            fontSize: 11.5,
                          }}
                        >
                          ✓ Verified in 2026
                        </span>
                      ) : (
                        <span className="badge" style={{ fontSize: 11.5 }}>
                          Pending statement import
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
