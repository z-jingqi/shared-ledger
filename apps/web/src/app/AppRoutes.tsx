import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AccountSettingsPage, LoginPage, RegisterPage, SubscriptionPage } from "../pages/AccountPages";
import { AiPage } from "../pages/AiPage";
import { BookHomePage } from "../pages/BookPages";
import { BooksPage } from "../pages/BooksManagePage";
import { CreateBookPage } from "../pages/CreateBookPage";
import { AnalysisPage } from "../pages/AnalysisPage";
import { ImportHistoryPage, PendingImportsPage } from "../pages/ImportPages";
import { InviteMemberPage, MemberRolePage, MembersPage } from "../pages/MemberPages";
import { AddLineItemsPage, RecordDetailPage, RecordsPage, TransactionFormPage } from "../pages/RecordPages";
import { ManagementSettingsPage, SettingsPage } from "../pages/SettingsPages";
import { ReceivedInvitationsPage, SentInvitationsPage } from "../pages/InvitationPages";
import { useAuth } from "../features/auth/AuthProvider";
import { useActiveBook } from "../hooks/useActiveBook";
import { IosCard, IosListSkeleton, IosPage, IosScroll } from "../components/ios/IosDesign";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Protected element={<HomeEntry />} />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/home" element={<Protected element={<BookHomePage />} />} />
      <Route path="/books" element={<Protected element={<BooksPage />} />} />
      <Route path="/books/manage" element={<Protected element={<BooksPage />} />} />
      <Route path="/books/new" element={<Protected element={<CreateBookPage />} />} />
      <Route path="/books/:id" element={<Protected element={<LegacyBookHomeRedirect />} />} />
      <Route path="/books/:id/settings" element={<Protected element={<ManagementSettingsPage />} />} />
      <Route path="/records" element={<Protected element={<RecordsPage />} />} />
      <Route path="/records/new" element={<Protected element={<TransactionFormPage />} />} />
      <Route path="/records/new/items" element={<Protected element={<AddLineItemsPage />} />} />
      <Route path="/records/pending" element={<Protected element={<PendingImportsPage />} />} />
      <Route path="/records/imports" element={<Protected element={<ImportHistoryPage />} />} />
      <Route path="/records/:id" element={<Protected element={<RecordDetailPage />} />} />
      <Route path="/records/:id/edit" element={<Protected element={<TransactionFormPage />} />} />
      <Route path="/imports" element={<Navigate to="/records" replace />} />
      <Route path="/imports/pending" element={<Navigate to="/records/pending" replace />} />
      <Route path="/imports/history" element={<Navigate to="/records/imports" replace />} />
      <Route path="/analysis" element={<Protected element={<AnalysisPage />} />} />
      <Route path="/members" element={<Protected element={<MembersPage />} />} />
      <Route path="/members/invite" element={<Protected element={<InviteMemberPage />} />} />
      <Route path="/members/role" element={<Protected element={<MemberRolePage />} />} />
      <Route path="/invitations/received" element={<Protected element={<ReceivedInvitationsPage />} />} />
      <Route path="/invitations/sent" element={<Protected element={<SentInvitationsPage />} />} />
      <Route path="/settings" element={<Protected element={<SettingsPage />} />} />
      <Route path="/settings/privacy" element={<Navigate to="/settings" replace />} />
      <Route path="/settings/notifications" element={<Navigate to="/settings" replace />} />
      <Route path="/settings/:tab" element={<Protected element={<ManagementSettingsPage />} />} />
      <Route path="/account" element={<Protected element={<AccountSettingsPage />} />} />
      <Route path="/subscription" element={<Protected element={<SubscriptionPage />} />} />
      <Route path="/ai" element={<Protected element={<AiPage />} />} />
    </Routes>
  );
}

function HomeEntry() {
  const { book, loading } = useActiveBook();
  if (loading) return <RouteLoadingSkeleton />;
  if (!book) return <Navigate to="/home" replace />;
  return <Navigate to={`/home?bookId=${book.id}`} replace />;
}

function LegacyBookHomeRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/home?bookId=${id}` : "/home"} replace />;
}

function Protected({ element }: { element: ReactNode }) {
  return <RequireAuth>{element}</RequireAuth>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <RouteLoadingSkeleton />;
  if (!user)
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
        replace
      />
    );
  return children;
}

function RouteLoadingSkeleton() {
  return (
    <IosPage>
      <IosScroll className="ios-main-tab-scroll">
        <IosCard>
          <IosListSkeleton rows={4} />
        </IosCard>
      </IosScroll>
    </IosPage>
  );
}
