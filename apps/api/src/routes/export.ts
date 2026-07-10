import type { FastifyPluginAsync } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { rowToJson } from '../services/loanMapper.js';
import { buildDashboard, currentMonth } from '../services/simulationService.js';

/** ExcelJS workbook with loans, strategy comparison and the optimized timeline (docs/15). */
export const exportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/export/excel', async (_req, reply) => {
    const rows = await prisma.loan.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    const loans = await Promise.all(rows.map((row) => rowToJson(row)));
    const dash = await buildDashboard({
      extraMonthlyPayment: 0,
      bonuses: [],
      opportunityRatePct: 6,
      startMonth: currentMonth(),
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Debt Optimizer';

    const loansSheet = wb.addWorksheet('Loans');
    loansSheet.columns = [
      { header: 'Lender', key: 'lender', width: 18 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Priority', key: 'priority', width: 9 },
      { header: 'Outstanding', key: 'outstandingAmount', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Rate %', key: 'annualInterestRate', width: 10 },
      { header: 'APR %', key: 'apr', width: 10 },
      { header: 'EMI', key: 'emi', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Remaining months', key: 'remainingMonths', width: 18 },
      { header: 'Foreclosure fee %', key: 'foreclosureFeePct', width: 18 },
      { header: 'Part-payment fee %', key: 'partPaymentFeePct', width: 18 },
    ];
    loansSheet.addRows(
      loans.map((l) => ({
        ...l,
        foreclosureFeePct: l.foreclosure.feePct,
        partPaymentFeePct: l.partPayment.feePct,
      })),
    );
    loansSheet.getRow(1).font = { bold: true };

    const cmpSheet = wb.addWorksheet('Strategy comparison');
    cmpSheet.columns = [
      { header: 'Strategy', key: 'strategy', width: 14 },
      { header: 'Months', key: 'months', width: 10 },
      { header: 'Debt-free', key: 'debtFreeMonth', width: 12 },
      { header: 'Total interest', key: 'totalInterest', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Total paid', key: 'totalPaid', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Interest saved vs current', key: 'interestSavedVsCurrent', width: 24, style: { numFmt: '#,##0.00' } },
    ];
    cmpSheet.addRows(dash.comparison);
    cmpSheet.getRow(1).font = { bold: true };

    const tlSheet = wb.addWorksheet('Timeline (optimized)');
    tlSheet.columns = [
      { header: 'Month', key: 'month', width: 10 },
      { header: 'Opening debt', key: 'totalOpening', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Interest', key: 'totalInterest', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Principal', key: 'totalPrincipal', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Paid', key: 'totalPaid', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Closing debt', key: 'totalClosing', width: 16, style: { numFmt: '#,##0.00' } },
    ];
    tlSheet.addRows(dash.timeline);
    tlSheet.getRow(1).font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="debt-optimizer.xlsx"')
      .send(Buffer.from(buffer));
  });
};
