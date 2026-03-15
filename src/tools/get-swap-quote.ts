import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getQuote } from "../relay-api.js";
import { buildRelayAppUrl } from "../deeplink.js";
import { resolveChainId, getChainVmType } from "../utils/chain-resolver.js";
import { resolveTokenAddress } from "../utils/token-resolver.js";
import {
  validateAddress,
  validateAddresses,
  validateAmount,
  validationError,
} from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";
import { NATIVE_TOKEN_ADDRESSES, AMOUNT_ENCODING, CHAIN_ID_FORMAT, TRADE_TYPE_DESC } from "../utils/descriptions.js";

export function register(server: McpServer) {
  server.tool(
    "get_swap_quote",
    `Get a quote for swapping between DIFFERENT tokens, same-chain or cross-chain (e.g. ETH → USDC on Base, or ETH on Ethereum → USDC on Base).

Use when input and output tokens differ. Works same-chain and cross-chain. For same-token bridging (e.g. ETH on Ethereum → ETH on Base), use get_bridge_quote instead — it's simpler.

Returns execution steps — each step contains ready-to-sign transaction data (to, data, value, chainId, gas). An agent with wallet tooling can sign and submit these directly. Also returns a relay.link deep link as a fallback for manual execution.

${AMOUNT_ENCODING} ${CHAIN_ID_FORMAT}`,
    {
      originChainId: z
        .union([z.number(), z.string()])
        .describe("Source chain ID or name (e.g. 1, 'ethereum', 'eth')."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe(
          "Destination chain ID or name (e.g. 8453, 'base'). Can be the same as originChainId for same-chain swaps."
        ),
      originCurrency: z
        .string()
        .describe(
          `Token address or symbol to swap from. Symbols like "ETH", "USDC", "USDT", "WETH" are resolved automatically. ${NATIVE_TOKEN_ADDRESSES}`
        ),
      destinationCurrency: z
        .string()
        .describe(
          `Token address or symbol to swap to. Symbols like "ETH", "USDC", "USDT", "WETH" are resolved automatically. ${NATIVE_TOKEN_ADDRESSES}`
        ),
      amount: z
        .string()
        .describe(
          "Amount to swap in the origin token's smallest unit. Examples: wei for ETH (18 decimals), satoshis for BTC (8 decimals), lamports for SOL (9 decimals)."
        ),
      sender: z.string().describe("Sender wallet address."),
      recipient: z
        .string()
        .optional()
        .describe("Recipient wallet address. Defaults to sender."),
      tradeType: z
        .enum(["EXACT_INPUT", "EXPECTED_OUTPUT", "EXACT_OUTPUT"])
        .optional()
        .default("EXACT_INPUT")
        .describe(TRADE_TYPE_DESC),
      useDepositAddress: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Use deposit address flow — returns an address the user can send funds to instead of transaction calldata. No wallet signing needed. Only supports EXACT_INPUT."
        ),
      refundTo: z
        .string()
        .optional()
        .describe(
          "Address to send refunds to if the swap fails. Defaults to sender."
        ),
      includeSteps: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include raw transaction steps for signing. Only needed if you have wallet tooling to submit transactions directly. Omit to save tokens."
        ),
    },
    async ({
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency,
      amount,
      sender,
      recipient,
      tradeType,
      useDepositAddress,
      refundTo,
      includeSteps,
    }) => {
      // Validate inputs
      const addrPairs: [string, string][] = [[sender, "sender"]];
      if (recipient) addrPairs.push([recipient, "recipient"]);
      const addrErr = validateAddresses(...addrPairs);
      if (addrErr) return addrErr;
      const amtErr = validateAmount(amount);
      if (amtErr) return validationError(amtErr);

      let resolvedOrigin: number;
      let resolvedDest: number;
      try {
        [resolvedOrigin, resolvedDest] = await Promise.all([
          resolveChainId(originChainId),
          resolveChainId(destinationChainId),
        ]);
      } catch (err) {
        return mcpCatchError(err);
      }

      // Resolve token symbols → addresses if needed
      let resolvedOriginCurrency: string;
      let resolvedDestCurrency: string;
      try {
        const [originVm, destVm] = await Promise.all([
          getChainVmType(resolvedOrigin),
          getChainVmType(resolvedDest),
        ]);
        [resolvedOriginCurrency, resolvedDestCurrency] = await Promise.all([
          resolveTokenAddress(originCurrency, resolvedOrigin, originVm),
          resolveTokenAddress(destinationCurrency, resolvedDest, destVm),
        ]);
      } catch (err) {
        return mcpCatchError(err);
      }

      let quote;
      try {
        quote = await getQuote({
          user: sender,
          originChainId: resolvedOrigin,
          destinationChainId: resolvedDest,
          originCurrency: resolvedOriginCurrency,
          destinationCurrency: resolvedDestCurrency,
          amount,
          tradeType,
          recipient,
          useDepositAddress: useDepositAddress || undefined,
          refundTo,
        });
      } catch (err) {
        return mcpCatchError(err);
      }

      const { steps, details, fees } = quote;
      const depositAddress = steps?.[0]?.depositAddress;
      const isCrossChain = resolvedOrigin !== resolvedDest;
      const action = isCrossChain ? "Cross-chain swap" : "Swap";
      const depositSummary = depositAddress
        ? ` Send funds to deposit address: ${depositAddress}`
        : "";
      const summary = `${action}: ${details.currencyIn.amountFormatted} ${details.currencyIn.currency.symbol} (chain ${resolvedOrigin}) → ${details.currencyOut.amountFormatted} ${details.currencyOut.currency.symbol} (chain ${resolvedDest}). Total fees: $${fees.relayer.amountUsd}. ETA: ~${details.timeEstimate}s.${depositSummary}`;

      const deeplinkUrl = await buildRelayAppUrl({
        destinationChainId: resolvedDest,
        fromChainId: resolvedOrigin,
        fromCurrency: resolvedOriginCurrency,
        toCurrency: resolvedDestCurrency,
        amount: details.currencyIn.amountFormatted,
        toAddress: recipient,
      });

      const content: Array<{ type: "text"; text: string } | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string }> = [
        { type: "text", text: summary },
        {
          type: "text",
          text: JSON.stringify(
            {
              amountIn: details.currencyIn.amountFormatted,
              amountOut: details.currencyOut.amountFormatted,
              amountInUsd: details.currencyIn.amountUsd,
              amountOutUsd: details.currencyOut.amountUsd,
              fees: {
                gas: { formatted: fees.gas.amountFormatted, usd: fees.gas.amountUsd },
                relayer: { formatted: fees.relayer.amountFormatted, usd: fees.relayer.amountUsd },
              },
              totalImpact: details.totalImpact,
              timeEstimateSeconds: details.timeEstimate,
              rate: details.rate,
              ...(depositAddress ? { depositAddress } : {}),
              ...(includeSteps ? { steps } : { stepsCount: steps.length }),
              relayAppUrl: deeplinkUrl ?? undefined,
            },
            null,
            2
          ),
        },
      ];

      if (deeplinkUrl) {
        content.push({
          type: "resource_link",
          uri: deeplinkUrl,
          name: "Execute swap on Relay",
          description: "Open the Relay app to sign and execute this swap",
          mimeType: "text/html",
        });
        content.push({
          type: "text",
          text: `To execute this swap, open the Relay app: ${deeplinkUrl}`,
        });
      }

      return { content };
    }
  );
}
