import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAppFeeBalances, getAppFeeClaims } from "../relay-api.js";
import { validateAddress, validationError } from "../utils/validators.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "get_app_fees",
    `Check claimable app fee balances and past claim history for an integrator wallet.

Use this to answer "how much have I earned?" or "what fees are claimable?" App fees are earned by integrators who route swaps/bridges through Relay with a referral fee configured.

Returns both current claimable balances and historical claims in one call.`,
    {
      wallet: z
        .string()
        .describe("Integrator wallet address to check app fees for."),
    },
    async ({ wallet }) => {
      const addrErr = validateAddress(wallet, "wallet");
      if (addrErr) return validationError(addrErr);

      // Graceful partial failure: return what we can even if one call fails.
      const warnings: string[] = [];
      const results = await Promise.allSettled([
        getAppFeeBalances(wallet),
        getAppFeeClaims(wallet),
      ]);

      // If both fail, return the first error
      if (
        results[0].status === "rejected" &&
        results[1].status === "rejected"
      ) {
        return mcpCatchError(results[0].reason);
      }

      const balances =
        results[0].status === "fulfilled"
          ? results[0].value.balances || []
          : (() => {
              warnings.push("Balance data unavailable.");
              return [];
            })();

      const claims =
        results[1].status === "fulfilled"
          ? results[1].value.claims || []
          : (() => {
              warnings.push("Claims history unavailable.");
              return [];
            })();

      const totalUsd = balances.reduce(
        (sum, b) => sum + (parseFloat(b.amountUsd) || 0),
        0
      );

      let summary =
        balances.length > 0
          ? `${wallet.slice(0, 6)}...${wallet.slice(-4)} has $${totalUsd.toFixed(2)} in claimable app fees across ${balances.length} token${balances.length !== 1 ? "s" : ""}. ${claims.length} past claim${claims.length !== 1 ? "s" : ""}.`
          : `No claimable app fees for ${wallet.slice(0, 6)}...${wallet.slice(-4)}. ${claims.length} past claim${claims.length !== 1 ? "s" : ""}.`;

      if (warnings.length) {
        summary += ` Note: ${warnings.join(" ")}`;
      }

      const data: Record<string, unknown> = {
        balances,
        claims,
        totalClaimableUsd: totalUsd.toFixed(2),
      };
      if (warnings.length) {
        data.warnings = warnings;
      }

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );
}
