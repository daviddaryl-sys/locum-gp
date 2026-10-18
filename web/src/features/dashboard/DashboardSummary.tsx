"use client";

import Link from "next/link";

import {
  parseExpenseData,
  resolveExpensePeriod,
  summarizeExpenses,
  type ExpenseData,
} from "@/domain/expense";
import { formatGBP, sumPence } from "@/domain/money";
import { parseInvoiceData } from "@/features/invoices/InvoiceViews";
import { parsePracticeData } from "@/features/practices/PracticeViews";
import { parseSessionData } from "@/features/sessions/SessionViews";
import { useOfflineRecords } from "@/offline/useRecords";

type DashboardInvoice = {
  status: "draft" | "sent" | "paid" | "cancelled";
  totalPence: number;
  issueDate: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  paidAt?: string | null;
};

type DashboardSession = {
  id: string;
  status: "planned" | "completed" | "invoiced" | "cancelled";
  startsAt: string;
  practiceName?: string;
};

export type DashboardMetrics = {
  paidThisYearPence: number;
  outstandingPence: number;
  overduePence: number;
  draftPence: number;
  uninvoicedCompletedCount: number;
  upcomingSessionCount: number;
  nextSessionStartsAt: string | null;
  nextSessionId: string | null;
  expenseThisTaxYearPence: number;
  undatedPaidCount?: number;
  nextSessionPracticeName?: string | null;
};

function londonCalendarDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/London",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function calculateDashboardMetrics({
  invoices,
  sessions,
  expenses = [],
  now,
}: {
  invoices: DashboardInvoice[];
  sessions: DashboardSession[];
  expenses?: ExpenseData[];
  now: Date;
}): DashboardMetrics {
  if (!Number.isFinite(now.getTime())) throw new Error("Dashboard date is invalid.");
  const today = londonCalendarDate(now);
  const year = today.slice(0, 4);
  const activeInvoices = invoices.filter((invoice) => invoice.status !== "cancelled");
  const total = (predicate: (invoice: DashboardInvoice) => boolean) =>
    sumPence(activeInvoices.filter(predicate).map((invoice) => invoice.totalPence));
  const upcoming = sessions
    .filter(
      (session) =>
        session.status === "planned" &&
        Number.isFinite(Date.parse(session.startsAt)) &&
        Date.parse(session.startsAt) > now.getTime(),
    )
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const expensePeriod = resolveExpensePeriod("tax-year", today);

  return {
    paidThisYearPence: total(
      (invoice) =>
        invoice.status === "paid" && invoice.paidAt?.slice(0, 4) === year,
    ),
    outstandingPence: total((invoice) => invoice.status === "sent"),
    overduePence: total(
      (invoice) =>
        invoice.status === "sent" &&
        Boolean(invoice.dueDate) &&
        invoice.dueDate! < today,
    ),
    draftPence: total((invoice) => invoice.status === "draft"),
    uninvoicedCompletedCount: sessions.filter(
      (session) => session.status === "completed",
    ).length,
    upcomingSessionCount: upcoming.length,
    nextSessionStartsAt: upcoming[0]?.startsAt ?? null,
    nextSessionId: upcoming[0]?.id ?? null,
    expenseThisTaxYearPence: summarizeExpenses(expenses, expensePeriod).netPence,
    undatedPaidCount: activeInvoices.filter(
      (invoice) => invoice.status === "paid" && !invoice.paidAt,
    ).length,
    nextSessionPracticeName: upcoming[0]?.practiceName ?? null,
  };
}

function MetricCard({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: string;
  href: string;
  tone?: "primary" | "danger";
}) {
  return <Link aria-label={`${label}: ${value}`} className="financial-metric" data-tone={tone} href={href}><span>{label}</span><strong>{value}</strong></Link>;
}

type DashboardToolIconName =
  | "expenses"
  | "tax-mtd"
  | "session"
  | "invoice";

function DashboardToolIcon({ icon }: { icon: DashboardToolIconName }) {
  return (
    <svg
      aria-hidden="true"
      data-icon={icon}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      {icon === "expenses" ? (
        <>
          <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3" />
          <path d="m14.5 16.5 1.5 1.5 3-3" />
        </>
      ) : icon === "tax-mtd" ? (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M9 12h6M9 16h6" />
        </>
      ) : icon === "invoice" ? (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5M12 12v6M9 15h6" />
        </>
      ) : (
        <>
          <path d="M5 5h14v15H5zM8 3v4M16 3v4M5 9h14" />
          <path d="M12 12v5M9.5 14.5h5" />
        </>
      )}
    </svg>
  );
}

function DashboardTool({
  children,
  href,
  icon,
  title,
}: {
  children: React.ReactNode;
  href: string;
  icon: DashboardToolIconName;
  title: string;
}) {
  const descriptionId = `dashboard-tool-${icon}-description`;
  return (
    <Link
      aria-describedby={descriptionId}
      aria-label={title}
      className="dashboard-tool"
      href={href}
    >
      <span
        aria-hidden="true"
        className="dashboard-tool__icon"
        data-tone={icon}
      >
        <DashboardToolIcon icon={icon} />
      </span>
      <span className="dashboard-tool__copy">
        <strong>{title}</strong>
        <span id={descriptionId}>{children}</span>
      </span>
      <span aria-hidden="true" className="dashboard-tool__trailing">›</span>
    </Link>
  );
}

export function DashboardSummary({ metrics }: { metrics: DashboardMetrics }) {
  const nextSession = metrics.nextSessionStartsAt
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/London",
      }).format(new Date(metrics.nextSessionStartsAt))
    : "Add your next booking when you are ready.";
  const hasNextSession = Boolean(metrics.nextSessionId && metrics.nextSessionStartsAt);
  const needsAttention = metrics.overduePence > 0 || metrics.uninvoicedCompletedCount > 0 || (metrics.undatedPaidCount ?? 0) > 0;
  return (
    <div className="dashboard-summary">
      <header className="dashboard-heading">
        <div>
          <h1 id="dashboard-title">Home</h1>
          <p>{new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" }).format(new Date())}</p>
        </div>
        <Link aria-label="New session" className="primary-action dashboard-heading__action" href="/sessions/new"><span aria-hidden="true">+</span> New session</Link>
      </header>
      <div className="dashboard-focus">
        <Link
          aria-label={`Next session: ${metrics.nextSessionPracticeName ? `${metrics.nextSessionPracticeName}, ` : ""}${nextSession}`}
          className="dashboard-next"
          href={hasNextSession ? `/sessions/${metrics.nextSessionId}` : "/sessions/new"}
        >
          <span className="dashboard-next__label"><DashboardToolIcon icon="session" />Next session</span>
          <strong>{hasNextSession ? metrics.nextSessionPracticeName ?? "Your next booking" : "No sessions planned"}</strong>
          <span className="dashboard-next__date">{nextSession}</span>
          <span className="dashboard-next__footer">
            <span>{hasNextSession ? `${metrics.upcomingSessionCount} upcoming ${metrics.upcomingSessionCount === 1 ? "session" : "sessions"}` : "Add a session"}</span>
            <span aria-hidden="true">↗</span>
          </span>
        </Link>
        <section aria-labelledby="dashboard-attention-title" className="dashboard-attention">
          <h2 id="dashboard-attention-title">Needs attention</h2>
          {needsAttention ? (
            <ul>
              {metrics.overduePence > 0 ? <li><Link href="/invoices?status=overdue" data-tone="danger"><span><strong>Follow up overdue invoices</strong><span>{formatGBP(metrics.overduePence)} waiting for payment</span></span><span aria-hidden="true">›</span></Link></li> : null}
              {metrics.uninvoicedCompletedCount > 0 ? <li><Link href="/sessions?status=ready-to-invoice"><span><strong>Invoice completed work</strong><span>{metrics.uninvoicedCompletedCount} {metrics.uninvoicedCompletedCount === 1 ? "session is" : "sessions are"} ready</span></span><span aria-hidden="true">›</span></Link></li> : null}
              {(metrics.undatedPaidCount ?? 0) > 0 ? <li><Link href="/invoices?status=paid&period=missing-payment-date"><span><strong>Check payment dates</strong><span>{metrics.undatedPaidCount} paid {metrics.undatedPaidCount === 1 ? "invoice needs" : "invoices need"} a received date</span></span><span aria-hidden="true">›</span></Link></li> : null}
            </ul>
          ) : (
            <div className="dashboard-attention__empty"><span aria-hidden="true">✓</span><strong>You’re up to date</strong><p>No overdue invoices or completed sessions waiting to be invoiced.</p></div>
          )}
        </section>
      </div>
      <FinancialOverview metrics={metrics} />
      <section aria-labelledby="dashboard-tools-title" className="dashboard-tools">
        <h2 id="dashboard-tools-title">Manage your work</h2>
        <div className="dashboard-tools__grid">
          <DashboardTool href="/sessions/new" icon="session" title="Add session">
            Record a new locum session
          </DashboardTool>
          <DashboardTool href="/expenses" icon="expenses" title="Expenses">
            Record costs and receipts
          </DashboardTool>
          <DashboardTool href="/tax-mtd" icon="tax-mtd" title="Tax & MTD">
            Review quarterly digital tax totals
          </DashboardTool>
          <DashboardTool href="/invoices/new" icon="invoice" title="Create invoice">
            Prepare a new invoice
          </DashboardTool>
        </div>
      </section>
    </div>
  );
}

export function FinancialOverview({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <section
      aria-labelledby="financial-overview-title"
      className="financial-overview"
    >
      <h2 id="financial-overview-title">Financial overview</h2>
      <div className="financial-overview__grid">
        <MetricCard href="/invoices?status=paid&period=payment-year" label="Paid this year" tone="primary" value={formatGBP(metrics.paidThisYearPence)} />
        <MetricCard href="/invoices?status=sent" label="Outstanding" value={formatGBP(metrics.outstandingPence)} />
        <MetricCard href="/invoices?status=overdue" label="Overdue" tone={metrics.overduePence ? "danger" : undefined} value={formatGBP(metrics.overduePence)} />
        <MetricCard href="/invoices?status=draft" label="Draft invoices" value={formatGBP(metrics.draftPence)} />
        <MetricCard href="/sessions?status=ready-to-invoice" label="Ready to invoice" value={`${metrics.uninvoicedCompletedCount} ${metrics.uninvoicedCompletedCount === 1 ? "session" : "sessions"}`} />
        <MetricCard href="/expenses?period=tax-year" label="Expenses this tax year" value={formatGBP(metrics.expenseThisTaxYearPence)} />
      </div>
      <p className="financial-overview__note">Paid this year uses the date payment was received, from 1 January. Expenses use the current tax year.</p>
      {(metrics.undatedPaidCount ?? 0) > 0 ? <Link className="financial-overview__notice" href="/invoices?status=paid&period=missing-payment-date">{metrics.undatedPaidCount} paid {metrics.undatedPaidCount === 1 ? "invoice has" : "invoices have"} no payment date and {metrics.undatedPaidCount === 1 ? "is" : "are"} excluded. Review payment dates →</Link> : null}
    </section>
  );
}

export function useDashboardMetrics(): DashboardMetrics | null {
  const invoiceRecords = useOfflineRecords("invoices");
  const sessionRecords = useOfflineRecords("sessions");
  const expenseRecords = useOfflineRecords("expenses");
  const practiceRecords = useOfflineRecords("practices");
  if (!invoiceRecords || !sessionRecords || !expenseRecords || !practiceRecords) {
    return null;
  }
  const invoices = invoiceRecords
    .map((record) => parseInvoiceData(record.data))
    .filter((invoice): invoice is NonNullable<typeof invoice> => Boolean(invoice));
  const practiceNames = new Map(practiceRecords.flatMap((record) => {
    const practice = parsePracticeData(record.data);
    return practice ? [[record.id, practice.name] as const] : [];
  }));
  const sessions = sessionRecords
    .map((record) => {
      const data = parseSessionData(record.data);
      return data ? { id: record.id, ...data, practiceName: practiceNames.get(data.practiceId) } : null;
    })
    .filter((session): session is NonNullable<typeof session> => Boolean(session));
  const expenses = expenseRecords
    .map((record) => parseExpenseData(record.data))
    .filter((expense): expense is ExpenseData => Boolean(expense));
  return calculateDashboardMetrics({ invoices, sessions, expenses, now: new Date() });
}

export function DashboardWorkspace() {
  const metrics = useDashboardMetrics();
  if (!metrics) {
    return <p className="record-page__runtime" role="status">Preparing offline dashboard</p>;
  }
  return (
    <DashboardSummary metrics={metrics} />
  );
}
