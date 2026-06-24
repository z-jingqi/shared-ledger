import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccountSettingsPage, LoginPage, RegisterPage, SubscriptionPage } from "../pages/AccountPages";
import { AiPage } from "../pages/AiPage";
import { BookHomePage, BooksPage, CreateBookPage } from "../pages/BookPages";
import { AnalysisPage } from "../pages/AnalysisPage";
import { ImportHistoryPage, ImportsPage, PendingImportsPage } from "../pages/ImportPages";
import { InviteMemberPage, MemberRolePage, MembersPage } from "../pages/MemberPages";
import { AddLineItemsPage, RecordDetailPage, RecordsPage, TransactionFormPage } from "../pages/RecordPages";
import { ManagementSettingsPage, SettingsPage } from "../pages/SettingsPages";
import { ReceivedInvitationsPage, SentInvitationsPage } from "../pages/InvitationPages";
import { useAuth } from "../features/auth/AuthProvider";

export function AppRoutes() {
  const { user } = useAuth();
  const plan = user?.plan ?? "free";
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/books" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/books" element={<Protected element={<BooksPage />} />} />
      <Route path="/books/new" element={<Protected element={<CreateBookPage />} />} />
      <Route path="/books/:id" element={<Protected element={<BookHomePage />} />} />
      <Route path="/books/:id/settings" element={<Protected element={<ManagementSettingsPage />} />} />
      <Route path="/records" element={<Protected element={<RecordsPage />} />} />
      <Route path="/records/new" element={<Protected element={<TransactionFormPage />} />} />
      <Route path="/records/new/items" element={<Protected element={<AddLineItemsPage />} />} />
      <Route path="/records/:id" element={<Protected element={<RecordDetailPage />} />} />
      <Route path="/records/:id/edit" element={<Protected element={<TransactionFormPage />} />} />
      <Route path="/imports" element={<Protected element={<ImportsPage />} />} />
      <Route path="/imports/pending" element={<Protected element={<PendingImportsPage />} />} />
      <Route path="/imports/history" element={<Protected element={<ImportHistoryPage />} />} />
      <Route path="/analysis" element={<Protected element={<AnalysisPage />} />} />
      <Route path="/members" element={<Protected element={<MembersPage />} />} />
      <Route path="/members/invite" element={<Protected element={<InviteMemberPage />} />} />
      <Route path="/members/role" element={<Protected element={<MemberRolePage />} />} />
      <Route path="/invitations/received" element={<Protected element={<ReceivedInvitationsPage />} />} />
      <Route path="/invitations/sent" element={<Protected element={<SentInvitationsPage />} />} />
      <Route path="/settings" element={<Protected element={<SettingsPage />} />} />
      <Route path="/settings/:tab" element={<Protected element={<ManagementSettingsPage />} />} />
      <Route path="/account" element={<Protected element={<AccountSettingsPage />} />} />
      <Route path="/subscription" element={<Protected element={<SubscriptionPage />} />} />
      <Route
        path="/ai"
        element={<Protected element={plan === "pro" ? <AiPage /> : <Navigate to="/subscription" replace />} />}
      />
    </Routes>
  );
}

function Protected({ element }: { element: ReactNode }) {
  return <RequireAuth>{element}</RequireAuth>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted auth-loading">正在确认登录状态…</p>;
  if (!user)
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
      />
    );
  return children;
}
