import { Navigate, Route, Routes } from "react-router-dom";
import { AccountSettingsPage, AuthPage, SubscriptionPage } from "../pages/AccountPages";
import { AiPage } from "../pages/AiPage";
import { AiProviderPage } from "../pages/AiProviderPage";
import { BookHomePage, BooksPage, CreateBookPage } from "../pages/BookPages";
import { AnalysisPage } from "../pages/AnalysisPage";
import { ImportHistoryPage, ImportsPage, PendingImportsPage } from "../pages/ImportPages";
import { InviteMemberPage, MemberRolePage, MembersPage } from "../pages/MemberPages";
import { RecordDetailPage, RecordsPage, TransactionFormPage } from "../pages/RecordPages";
import { ManagementSettingsPage, SettingsPage } from "../pages/SettingsPages";
import { ReceivedInvitationsPage, SentInvitationsPage } from "../pages/InvitationPages";
import { useAuth } from "../features/auth/AuthProvider";

export function AppRoutes() {
  const { user } = useAuth();
  const plan = user?.plan ?? "free";
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/books" replace />} />
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
      <Route path="/invitations/received" element={<ReceivedInvitationsPage />} />
      <Route path="/invitations/sent" element={<SentInvitationsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/:tab" element={<ManagementSettingsPage />} />
      <Route path="/settings/ai-provider" element={<AiProviderPage />} />
      <Route path="/account" element={<AccountSettingsPage />} />
      <Route path="/subscription" element={<SubscriptionPage />} />
      <Route path="/ai" element={plan === "pro" ? <AiPage /> : <Navigate to="/subscription" replace />} />
    </Routes>
  );
}
