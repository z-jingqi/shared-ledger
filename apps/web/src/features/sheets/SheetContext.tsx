import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

export type AppSheet =
  | { type: "record-form"; recordId?: string; initialType?: "expense" | "income" }
  | { type: "record-detail"; transactionId: string }
  | { type: "imports" }
  | { type: "pending-imports" }
  | { type: "members" }
  | { type: "ai" }
  | { type: "settings-export" }
  | { type: "settings-help" }
  | { type: "settings-about" };

type AppSheetContextValue = {
  sheet: AppSheet | undefined;
};

type AppSheetActionsContextValue = {
  openSheet: (sheet: AppSheet) => void;
  closeSheet: () => void;
};

const AppSheetContext = createContext<AppSheetContextValue | undefined>(undefined);
const AppSheetActionsContext = createContext<AppSheetActionsContextValue | undefined>(undefined);

export function AppSheetProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<AppSheet | undefined>();
  const openSheet = useCallback((nextSheet: AppSheet) => setSheet(nextSheet), []);
  const closeSheet = useCallback(() => setSheet(undefined), []);
  const stateValue = useMemo(() => ({ sheet }), [sheet]);
  const actionsValue = useMemo(() => ({ openSheet, closeSheet }), [closeSheet, openSheet]);
  return (
    <AppSheetActionsContext value={actionsValue}>
      <AppSheetContext value={stateValue}>{children}</AppSheetContext>
    </AppSheetActionsContext>
  );
}

export function useAppSheet() {
  const state = use(AppSheetContext);
  const actions = use(AppSheetActionsContext);
  if (!state || !actions) throw new Error("useAppSheet must be used within AppSheetProvider");
  return { ...state, ...actions };
}

export function useAppSheetActions() {
  const value = use(AppSheetActionsContext);
  if (!value) throw new Error("useAppSheetActions must be used within AppSheetProvider");
  return value;
}
