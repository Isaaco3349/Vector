import type { Eip1193Provider } from "./appkit";
import { chainIdHex } from "./network";
import { arcViemChain } from "./viem-arc-chain";

/** EIP-3085 params so OKX / MetaMask / Rabby register Arc with USDC as native gas. */
export function arcAddEthereumChainParams() {
  const explorer = arcViemChain.blockExplorers?.default.url;
  return {
    chainId: chainIdHex,
    chainName: arcViemChain.name,
    nativeCurrency: {
      name: arcViemChain.nativeCurrency.name,
      symbol: arcViemChain.nativeCurrency.symbol,
      decimals: arcViemChain.nativeCurrency.decimals,
    },
    rpcUrls: [...arcViemChain.rpcUrls.default.http],
    ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
  };
}

/**
 * Switch to Arc, adding the chain first if the wallet doesn't know it (common on OKX).
 */
export async function ensureArcNetwork(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? Number((err as { code: unknown }).code)
        : undefined;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [arcAddEthereumChainParams()],
      });
      return;
    }
    throw err;
  }
}
