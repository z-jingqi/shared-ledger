import { BrowserRouter } from "react-router-dom";
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
      </AuthProvider>
    </BrowserRouter>
  );
}
