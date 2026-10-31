const DEFAULT_FRIENDBOT_URL = "https://friendbot.stellar.org";
const FRIENDBOT_TIMEOUT_MS = 20_000;

export interface FriendbotResult {
  funded: boolean;
  txHash: string | null;
  error?: string;
}

/**
 * Funds a testnet account with friendbot. An account that already exists counts as funded (friendbot answers 400 "createAccountAlreadyExist").
 */
export async function fundWithFriendbot(
  address: string,
  baseUrl: string = DEFAULT_FRIENDBOT_URL
): Promise<FriendbotResult> {
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/?addr=${encodeURIComponent(address)}`,
      { signal: AbortSignal.timeout(FRIENDBOT_TIMEOUT_MS) }
    );
    const body = (await res.json().catch(() => ({}))) as {
      hash?: string;
      detail?: string;
      extras?: { result_codes?: { operations?: string[] } };
    };
    if (res.ok) return { funded: true, txHash: body.hash ?? null };
    const alreadyExists =
      body.extras?.result_codes?.operations?.includes("op_already_exists") ||
      /already/i.test(body.detail ?? "");
    if (alreadyExists) return { funded: true, txHash: null };
    return { funded: false, txHash: null, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      funded: false,
      txHash: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
