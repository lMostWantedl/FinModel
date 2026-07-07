-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lender" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERSONAL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "loanAmount" REAL NOT NULL DEFAULT 0,
    "disbursedAmount" REAL NOT NULL DEFAULT 0,
    "outstandingAmount" REAL NOT NULL,
    "annualInterestRate" REAL NOT NULL,
    "apr" REAL NOT NULL DEFAULT 0,
    "reducingBalance" BOOLEAN NOT NULL DEFAULT true,
    "emi" REAL NOT NULL,
    "emiDay" INTEGER NOT NULL DEFAULT 1,
    "tenureMonths" INTEGER NOT NULL DEFAULT 0,
    "remainingMonths" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "processingFee" REAL NOT NULL DEFAULT 0,
    "totalInterest" REAL NOT NULL DEFAULT 0,
    "totalRepayment" REAL NOT NULL DEFAULT 0,
    "foreclosureJson" TEXT NOT NULL DEFAULT '{"allowed":true,"lockInMonths":0,"feePct":0}',
    "partPaymentJson" TEXT NOT NULL DEFAULT '{"allowed":true,"lockInMonths":0,"feePct":0,"minAmount":0}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "kind" TEXT NOT NULL,
    CONSTRAINT "payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scenarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "extraMonthlyPayment" REAL NOT NULL DEFAULT 0,
    "bonusMonth" INTEGER,
    "bonusAmount" REAL,
    "opportunityRatePct" REAL NOT NULL DEFAULT 6,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDebt" REAL NOT NULL,
    "dataJson" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "preset" BOOLEAN NOT NULL DEFAULT false,
    "budgetMonthly" REAL
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "categoryId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'UPI',
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "billingMonth" INTEGER,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscriptions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "categoryId" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "note" TEXT NOT NULL DEFAULT '',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "loanId" TEXT,
    "subscriptionId" TEXT,
    "periodKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "entries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "simulation_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strategy" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "comparisonJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_kind_key" ON "categories"("name", "kind");

-- CreateIndex
CREATE INDEX "entries_date_idx" ON "entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "entries_loanId_periodKey_key" ON "entries"("loanId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "entries_subscriptionId_periodKey_key" ON "entries"("subscriptionId", "periodKey");
