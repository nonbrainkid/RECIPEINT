export type ProviderRequest = {
  method: string;
  params?: unknown[];
};

export type EvmProvider = {
  request: (args: ProviderRequest) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  providers?: EvmProvider[];
  isMetaMask?: boolean;
  isPhantom?: boolean;
};

export type Eip6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: EvmProvider;
};

export type WalletOption = {
  id: string;
  name: string;
  rdns: string;
  icon: string | null;
  source: "eip6963" | "legacy";
  provider: EvmProvider;
};

const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|webp|gif|svg\+xml)(?:;[a-z0-9=.+-]+)*(?:;base64)?,/i;

function safeLabel(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

export function safeWalletIcon(value: unknown) {
  return typeof value === "string" && SAFE_DATA_IMAGE.test(value) ? value : null;
}

export function walletInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "W")
    .toUpperCase();
}

export function legacyWalletName(provider: EvmProvider) {
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

export function toEip6963Wallet(detail: Eip6963ProviderDetail): WalletOption | null {
  if (
    !detail ||
    !detail.info ||
    typeof detail.info.uuid !== "string" ||
    !detail.info.uuid.trim() ||
    !detail.provider ||
    typeof detail.provider.request !== "function"
  ) {
    return null;
  }
  const uuid = safeLabel(detail.info.uuid, "", 128);
  if (!uuid) return null;
  return {
    id: `eip6963:${uuid}`,
    name: safeLabel(detail.info.name, "Browser wallet", 80),
    rdns: safeLabel(detail.info.rdns, "Self-attested provider", 120),
    icon: safeWalletIcon(detail.info.icon),
    source: "eip6963",
    provider: detail.provider,
  };
}

export function mergeWalletOptions(
  announced: WalletOption[],
  legacyProviders: EvmProvider[],
): WalletOption[] {
  const result: WalletOption[] = [];
  const ids = new Set<string>();
  const providers = new Set<EvmProvider>();

  for (const wallet of announced) {
    if (wallet.source !== "eip6963" || ids.has(wallet.id) || providers.has(wallet.provider)) continue;
    ids.add(wallet.id);
    providers.add(wallet.provider);
    result.push(wallet);
  }

  let legacyIndex = 0;
  for (const provider of legacyProviders) {
    if (!provider || typeof provider.request !== "function" || providers.has(provider)) continue;
    providers.add(provider);
    const name = legacyWalletName(provider);
    result.push({
      id: `legacy:${legacyIndex++}:${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      rdns: "Legacy injected provider",
      icon: null,
      source: "legacy",
      provider,
    });
  }
  return result;
}

export function safeProviderError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? Number((error as { code?: unknown }).code)
      : Number.NaN;
  if (code === 4001) return "Wallet request was rejected.";
  if (code === -32002) return "A wallet request is already pending. Open the selected wallet.";
  return "Wallet request failed. Check the selected wallet and try again.";
}
