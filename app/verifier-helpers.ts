export type EvidenceStatus = "confirmed" | "warning" | "unknown" | "mismatch";

export type EvidenceRow = {
  status: EvidenceStatus;
};

export const MANIFEST_SCHEMA = "recipeint.launch-manifest/0.1";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const UINT256_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const MAX_REASONABLE_DECIMALS = 77;

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function parsePreparedTransaction(input: string) {
  if (!input.trim()) return null;
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const rawChain = parsed.chainId;
    let chainId: number | null = null;
    let chainIdProvided = false;

    if (typeof rawChain === "string" && rawChain.trim()) {
      chainIdProvided = true;
      chainId = rawChain.toLowerCase().startsWith("0x")
        ? Number.parseInt(rawChain, 16)
        : Number.parseInt(rawChain, 10);
    } else if (typeof rawChain === "number") {
      chainIdProvided = true;
      chainId = rawChain;
    }

    if (chainId !== null && (!Number.isSafeInteger(chainId) || chainId < 0)) chainId = null;

    return {
      to: typeof parsed.to === "string" ? parsed.to : "",
      from: typeof parsed.from === "string" ? parsed.from : "",
      value: typeof parsed.value === "string" ? parsed.value : "0x0",
      data:
        typeof parsed.data === "string"
          ? parsed.data
          : typeof parsed.input === "string"
            ? parsed.input
            : "0x",
      chainId,
      chainIdProvided,
    };
  } catch {
    return { error: true } as const;
  }
}

export function aggregateEvidenceStatus(rows: EvidenceRow[]) {
  if (rows.some((row) => row.status === "mismatch")) {
    return { status: "mismatch" as const, label: "Launch mismatch" };
  }
  if (rows.some((row) => row.status === "warning")) {
    return {
      status: "warning" as const,
      label: rows.some((row) => row.status === "unknown")
        ? "Warnings + incomplete evidence"
        : "Warnings found",
    };
  }
  if (!rows.length || rows.some((row) => row.status === "unknown")) {
    return { status: "unknown" as const, label: "Incomplete evidence" };
  }
  return { status: "confirmed" as const, label: "Parameters match" };
}

export function detectEip1167Implementation(runtimeCode?: string | null) {
  if (!runtimeCode) return null;
  const match = runtimeCode
    .toLowerCase()
    .match(/^0x363d3d373d3d3d363d73([a-f0-9]{40})5af43d82803e903d91602b57fd5bf3$/);
  return match ? `0x${match[1]}` : null;
}

export function parseAbiUint256(hex?: string | null) {
  if (!hex || !UINT256_PATTERN.test(hex)) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

export function parseTokenDecimals(hex?: string | null) {
  const value = parseAbiUint256(hex);
  if (value === null || value > BigInt(MAX_REASONABLE_DECIMALS)) return null;
  return Number(value);
}

export function formatTokenUnits(raw: bigint, decimals: number) {
  if (decimals === 0) return raw.toLocaleString("en-US");
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function compareExactSupply(
  expectedHuman: string | undefined,
  rawSupplyHex: string | null | undefined,
  decimals: number | null,
) {
  if (decimals === null) {
    return { status: "unknown" as const, detail: "Token decimals could not be read safely." };
  }
  const rawSupply = parseAbiUint256(rawSupplyHex);
  if (rawSupply === null) {
    return { status: "unknown" as const, detail: "totalSupply() did not return a valid uint256." };
  }
  const normalizedExpected = expectedHuman?.replace(/,/g, "").trim() || "";
  if (!/^(0|[1-9][0-9]*)$/.test(normalizedExpected)) {
    return { status: "unknown" as const, detail: "The manifest has no valid integer supply declaration." };
  }
  const expectedRaw = BigInt(normalizedExpected) * 10n ** BigInt(decimals);
  return {
    status: expectedRaw === rawSupply ? ("confirmed" as const) : ("mismatch" as const),
    expectedRaw,
    actualRaw: rawSupply,
    detail:
      expectedRaw === rawSupply
        ? "Exact raw uint256 matches the declared human supply and decimals."
        : "Exact raw uint256 differs from the declared human supply scaled by decimals.",
  };
}

type ProvenanceInput = {
  hasTransaction: boolean;
  receiptContractAddress?: string | null;
  providedTokenAddress?: string | null;
};

export function classifyTokenProvenance({
  hasTransaction,
  receiptContractAddress,
  providedTokenAddress,
}: ProvenanceInput) {
  const receiptAddress = ADDRESS_PATTERN.test(receiptContractAddress || "")
    ? (receiptContractAddress as string)
    : null;
  const providedAddress = ADDRESS_PATTERN.test(providedTokenAddress || "")
    ? (providedTokenAddress as string)
    : null;

  if (!hasTransaction) {
    return {
      status: "unknown" as const,
      actual: providedAddress || "Not provided",
      detail: "Token-only inspection cannot prove which launch transaction created this contract.",
      inspectionAddress: providedAddress,
    };
  }
  if (receiptAddress) {
    if (providedAddress && providedAddress.toLowerCase() !== receiptAddress.toLowerCase()) {
      return {
        status: "mismatch" as const,
        actual: providedAddress,
        detail: `Direct deployment receipt created ${receiptAddress}, not the supplied token address.`,
        inspectionAddress: providedAddress,
      };
    }
    return {
      status: "confirmed" as const,
      actual: receiptAddress,
      detail: "Direct deployment address is proven by receipt.contractAddress.",
      inspectionAddress: receiptAddress,
    };
  }
  return {
    status: "unknown" as const,
    actual: providedAddress || "Not provided",
    detail: providedAddress
      ? "Factory receipt has no contractAddress; the manually supplied token address is not provenance proof."
      : "Factory receipt has no contractAddress. Supply a token address for inspection, but provenance remains Unknown.",
    inspectionAddress: providedAddress,
  };
}

export function normalizeRpcQuantity(value?: string | null) {
  if (!value || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function evaluateManifestIntegrity(
  manifest: Record<string, unknown> | null,
  now = Date.now(),
) {
  if (!manifest) {
    return {
      status: "unknown" as const,
      actual: "No local manifest",
      detail: "Onchain inspection can continue, but intended launch values are unavailable.",
    };
  }

  const { signature: _signature, manifestHash, ...unsignedManifest } = manifest;
  const recomputed = await sha256Hex(canonicalize(unsignedManifest));
  if (typeof manifestHash !== "string" || recomputed.toLowerCase() !== manifestHash.toLowerCase()) {
    return {
      status: "mismatch" as const,
      actual: "Manifest hash mismatch",
      detail: "The saved fields no longer match manifestHash; local data may have been edited.",
    };
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) {
    return {
      status: "mismatch" as const,
      actual: "Unsupported schema",
      detail: `Expected ${MANIFEST_SCHEMA}.`,
    };
  }
  const expiresAt = typeof manifest.expiresAt === "string" ? Date.parse(manifest.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return {
      status: "mismatch" as const,
      actual: "Manifest expired",
      detail: "An expired or malformed intent must not be treated as current authorization.",
    };
  }
  return {
    status: "unknown" as const,
    actual: typeof _signature === "string" ? "Hash matches; signature not recovery-validated" : "Hash matches; unsigned",
    detail:
      "Canonical hash integrity passed, but this page does not independently recover and validate the EIP-712 signer.",
  };
}
