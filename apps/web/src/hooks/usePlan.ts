import type { SubscriptionPlan } from "@shared-ledger/shared";
import { useState } from "react";

const storageKey = "ledger-plan";

export function usePlan() {
  const [plan, setPlan] = useState<SubscriptionPlan>(
    () => (localStorage.getItem(storageKey) as SubscriptionPlan) || "free",
  );

  const updatePlan = (nextPlan: SubscriptionPlan) => {
    localStorage.setItem(storageKey, nextPlan);
    setPlan(nextPlan);
  };

  return { plan, updatePlan };
}
