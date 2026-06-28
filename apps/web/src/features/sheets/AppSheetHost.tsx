import { AiSheet } from "../../pages/AiPage";
import { ImportHistorySheet, PendingImportsSheet } from "../../pages/ImportPages";
import { MembersSheet } from "../../pages/MemberPages";
import { RecordDetailSheet, TransactionFormSheet } from "../../pages/RecordPages";
import { AboutSheet, ExportSheet, HelpSheet } from "../../pages/SettingsPages";
import { useAppSheet } from "./SheetContext";

export function AppSheetHost({ bookId, currency }: { bookId?: string; currency?: string }) {
  const { sheet, openSheet, closeSheet } = useAppSheet();
  if (!sheet) return null;
  if (sheet.type === "record-form") {
    return <TransactionFormSheet recordId={sheet.recordId} initialType={sheet.initialType} onClose={closeSheet} />;
  }
  if (sheet.type === "record-detail") {
    return (
      <RecordDetailSheet
        bookId={bookId}
        currency={currency}
        transactionId={sheet.transactionId}
        onClose={closeSheet}
        onEdit={(transactionId) => openSheet({ type: "record-form", recordId: transactionId })}
      />
    );
  }
  if (sheet.type === "imports") return <ImportHistorySheet onClose={closeSheet} />;
  if (sheet.type === "pending-imports") return <PendingImportsSheet onClose={closeSheet} />;
  if (sheet.type === "members") return <MembersSheet onClose={closeSheet} />;
  if (sheet.type === "ai") return <AiSheet onClose={closeSheet} />;
  if (sheet.type === "settings-export") return <ExportSheet onClose={closeSheet} />;
  if (sheet.type === "settings-help") return <HelpSheet onClose={closeSheet} />;
  if (sheet.type === "settings-about") return <AboutSheet onClose={closeSheet} />;
  return null;
}
