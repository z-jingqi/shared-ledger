import { BrowserRouter } from "react-router-dom";
import { AppFrame } from "./app/AppFrame";
import { AppRoutes } from "./app/AppRoutes";
import { usePlan } from "./hooks/usePlan";

export function App() {
  const { plan, updatePlan } = usePlan();

  return (
    <BrowserRouter>
      <AppFrame plan={plan}>
        <AppRoutes plan={plan} setPlan={updatePlan} />
      </AppFrame>
    </BrowserRouter>
  );
}
