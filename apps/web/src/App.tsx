import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AppFrame } from "./app/AppFrame";
import { AppRoutes } from "./app/AppRoutes";
import { AuthProvider } from "./features/auth/AuthProvider";
import { ledgerQueryClient } from "./features/data/queryClient";

export function App() {
  return (
    <QueryClientProvider client={ledgerQueryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppFrame>
            <AppRoutes />
          </AppFrame>
          <Toaster richColors closeButton duration={3000} position="top-center" />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
