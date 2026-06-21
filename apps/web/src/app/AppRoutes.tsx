import type { SubscriptionPlan } from "@shared-ledger/shared";
import { Navigate, Route, Routes } from "react-router-dom";
import { AccountSettingsPage, AuthPage, SubscriptionPage } from "../pages/AccountPages";
import { AiPage } from "../pages/AiPage";
import { BookHomePage, BooksPage, CreateBookPage } from "../pages/BookPages";
import { AnalysisPage } from "../pages/AnalysisPage";
import { ImportHistoryPage, ImportsPage, PendingImportsPage } from "../pages/ImportPages";
import { InviteMemberPage, MemberRolePage, MembersPage } from "../pages/MemberPages";
import { RecordDetailPage, RecordsPage, TransactionFormPage } from "../pages/RecordPages";
import { ManagementSettingsPage, SettingsPage } from "../pages/SettingsPages";

export function AppRoutes({
  plan,
  setPlan,
}: {
  plan: SubscriptionPlan;
  setPlan: (plan: SubscriptionPlan) => void;
}) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/books/book_home" replace />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route path="/books" element={<BooksPage />} />
      <Route path="/books/new" element={<CreateBookPage />} />
      <Route path="/books/:id" element={<BookHomePage />} />
      <Route path="/books/:id/settings" element={<ManagementSettingsPage />} />
      <Route path="/records" element={<RecordsPage />} />
      <Route path="/records/new" element={<TransactionFormPage />} />
      <Route path="/records/new/items" element={<ManagementSettingsPage />} />
      <Route path="/records/:id" element={<RecordDetailPage />} />
      <Route path="/records/:id/edit" element={<TransactionFormPage />} />
      <Route path="/imports" element={<ImportsPage />} />
      <Route path="/imports/pending" element={<PendingImportsPage />} />
      <Route path="/imports/history" element={<ImportHistoryPage />} />
      <Route path="/analysis" element={<AnalysisPage />} />
      <Route path="/members" element={<MembersPage />} />
      <Route path="/members/invite" element={<InviteMemberPage />} />
      <Route path="/members/role" element={<MemberRolePage />} />
      <Route path="/invitations/received" element={<ManagementSettingsPage />} />
      <Route path="/invitations/sent" element={<ManagementSettingsPage />} />
      <Route path="/settings" element={<SettingsPage plan={plan} setPlan={setPlan} />} />
      <Route path="/settings/:tab" element={<ManagementSettingsPage />} />
      <Route path="/account" element={<AccountSettingsPage />} />
      <Route path="/subscription" element={<SubscriptionPage setPlan={setPlan} />} />
      <Route path="/ai" element={plan === "pro" ? <AiPage /> : <Navigate to="/subscription" replace />} />
    </Routes>
  );
}
