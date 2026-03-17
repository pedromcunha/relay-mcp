/**
 * Shared description fragments and config constants.
 * Keeps repeated text and URLs in one place instead of duplicating across tools.
 */

/** Base URL for the Relay web app (deep links, tracking pages). */
export const RELAY_APP_URL = process.env.RELAY_APP_URL || "https://relay.link";

export const NATIVE_TOKEN_ADDRESSES =
  'For native tokens use: EVM "0x0000000000000000000000000000000000000000", Solana "11111111111111111111111111111111", Bitcoin "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", Hyperliquid "0x00000000000000000000000000000000", Lighter "0". For other tokens, use the contract/mint address or look up via get_supported_tokens.';

export const AMOUNT_ENCODING =
  'Amounts must be in the token\'s smallest unit (wei, satoshis, lamports). Examples: 1 ETH = "1000000000000000000" (18 decimals), 1 USDC = "1000000" (6 decimals), 1 BTC = "100000000" (8 decimals), 1 SOL = "1000000000" (9 decimals). Use convert_amount or get_supported_tokens to look up decimals.';

export const CHAIN_ID_FORMAT =
  "Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb', 'bitcoin', 'solana').";

export const TRADE_TYPE_DESC =
  "EXACT_INPUT (default): you specify input amount, output varies. EXPECTED_OUTPUT: you specify desired output, input is calculated (allows slippage). EXACT_OUTPUT: you specify exact output required, fails if not deliverable.";
