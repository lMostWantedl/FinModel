import { useState } from 'react';
import { DashboardPage } from './pages/Dashboard';
import { LedgerPage } from './pages/Ledger';
import { LoansPage } from './pages/Loans';
import { ScenariosPage } from './pages/Scenarios';
import { SummaryPage } from './pages/Summary';

const TABS = ['Dashboard', 'Ledger', 'Summary', 'Loans', 'Scenarios'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="container">
      <header className="app-header">
        <h1>Debt Optimizer</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'Dashboard' && <DashboardPage />}
      {tab === 'Ledger' && <LedgerPage />}
      {tab === 'Summary' && <SummaryPage />}
      {tab === 'Loans' && <LoansPage />}
      {tab === 'Scenarios' && <ScenariosPage />}
    </div>
  );
}
