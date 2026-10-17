"use client";

import { useCallback, useState } from "react";

/** Google (W3S) panels: reload Circle token balances from the parent. */
export function useGooglePanelBalanceRefresh(
  onRefreshBalances?: () => Promise<void>,
) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!onRefreshBalances) return;
    setRefreshing(true);
    try {
      await onRefreshBalances();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshBalances]);

  return { refresh, refreshing };
}
