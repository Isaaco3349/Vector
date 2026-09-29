/** True when the active injected connector is OKX Wallet (extension or in-app browser). */
export function isOkxWallet(connector: { id: string; name?: string } | undefined): boolean {
  if (!connector) return false;
  const id = connector.id.toLowerCase();
  const name = (connector.name ?? "").toLowerCase();
  return (
    id.includes("okx") ||
    name.includes("okx") ||
    id === "com.okex.wallet" ||
    id === "okexwallet"
  );
}
