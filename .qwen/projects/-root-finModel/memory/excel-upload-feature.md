---
name: Excel Upload & Approval Workflow
description: Enable bulk Excel import for Log Income/Expense with pending approval dialog
type: project
---

**Rule:** Users can upload Excel files with columns: Sr.no | Date | Type (Transfer Debit/Credit) | Description | Debit | Credit | Balance to the `/entries/batch/upload` endpoint.

**Why:** Enables bulk import of UPI transfers, salary credits, expense payments, etc. while maintaining audit control through a review/approval step before entries reach the ledger.

**How to apply:**
1. Call `GET /entries/batch/categories` to get available categories for dropdown
2. POST multipart/form-data with `file` (Excel) + `categoryId` string → returns parsed rows summary
3. Entries appear as PENDING in Log Income/Expense dialog, fully editable before approval
4. Approve via `POST /entries/batch/approve?entryIds=...` to convert PENDING entries to regular ledger entries
5. Use `DELETE /entries/batch/:id` to revert individual pending entries
6. Type field mapping: "Transfer Debit" → EXPENSE, "Transfer Credit" → INCOME

**Files changed:**
- apps/api/prisma/schema.prisma (Entry model + description/debit/credit/balance fields)
- apps/api/src/schemas.ts (+ batchEntrySchema)
- apps/api/src/services/ledgerExcelService.ts (new service)
- apps/api/src/routes/entriesBatch.ts (new routes)
- apps/api/src/app.ts (+ batchRoutes registration)
