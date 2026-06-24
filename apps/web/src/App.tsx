import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { AppFrame } from "./app/AppFrame";
import { AppRoutes } from "./app/AppRoutes";
import { AuthProvider } from "./features/auth/AuthProvider";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppFrame>
          <AppRoutes />
        </AppFrame>
        <Toaster richColors closeButton duration={3000} position="top-center" />
      </AuthProvider>
    </BrowserRouter>
  );
}
