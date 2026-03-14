import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRouteConfigWithUser } from "../relay-api.js";
import { resolveChainId, getChainVmType } from "../utils/chain-resolver.js";
import { resolveTokenAddress } from "../utils/token-resolver.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";
import { NATIVE_TOKEN_ADDRESSES } from "../utils/descriptions.js";

export function register(server: McpServer) {
  server.tool(
    "get_user_balance",
    `Check a user's balance for a specific token on a route. Returns how much of the token the user holds on the origin chain and the maximum amount they can bridge/swap on this route.

Use this before quoting to verify the user has sufficient funds, or to show available balance context. Requires specifying both origin and destination chains since max bridgeable amount depends on the route.

Chain IDs can be numbers (8453) or names ('base', 'ethereum', 'arb', 'bitcoin', 'solana').`,
    {
      user: z.string().describe("Wallet address to check balance for."),
      originChainId: z
        .union([z.number(), z.string()])
        .describe("Origin chain ID or name (e.g. 1, 'ethereum')."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .describe("Destination chain ID or name (e.g. 8453, 'base')."),
      originCurrency: z
        .string()
        .describe(`Token address or symbol on the origin chain (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
      destinationCurrency: z
        .string()
        .describe(`Token address or symbol on the destination chain (e.g. "USDC", "ETH"). ${NATIVE_TOKEN_ADDRESSES}`),
    },
    async ({ user, originChainId, destinationChainId, originCurrency, destinationCurrency }) => {
      const addrErr = validateAddress(user, "user");
      if (addrErr) return validationError(addrErr);

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

      let config;
      try {
        config = await getRouteConfigWithUser(
          resolvedOrigin,
          resolvedDest,
          resolvedOriginCurrency,
          resolvedDestCurrency,
          user
        );
      } catch (err) {
        return mcpCatchError(err);
      }

      const routeEnabled = config.enabled !== false;
      const balance = config.user?.balance ?? "unknown";
      const maxAmount = config.user?.maxAmount ?? "unknown";
      const symbol = config.user?.currency?.symbol ?? originCurrency;
      const decimals = config.user?.currency?.decimals;

      let summary = `${user.slice(0, 6)}...${user.slice(-4)} on chain ${resolvedOrigin}: `;
      if (balance !== "unknown") {
        summary += `Balance: ${balance} ${symbol}. Max bridgeable: ${maxAmount} ${symbol}.`;
      } else {
        summary += `Balance data not available for this route.`;
      }
      summary += ` Route ${resolvedOrigin} → ${resolvedDest}: ${routeEnabled ? "enabled" : "disabled"}.`;

      return {
        content: [
          { type: "text", text: summary },
          {
            type: "text",
            text: JSON.stringify(
              {
                user,
                originChainId: resolvedOrigin,
                destinationChainId: resolvedDest,
                currency: {
                  address: resolvedOriginCurrency,
                  symbol,
                  ...(decimals !== undefined ? { decimals } : {}),
                },
                balance,
                maxBridgeableAmount: maxAmount,
                routeEnabled,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
