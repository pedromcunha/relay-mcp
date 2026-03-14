import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getChains,
  getChainHealth,
  getChainLiquidity,
  getRouteConfig,
  type Chain,
} from "../relay-api.js";
import { resolveChainId } from "../utils/chain-resolver.js";
import { mcpCatchError } from "../utils/errors.js";

export function register(server: McpServer) {
  server.tool(
    "check_chain_status",
    `Check if a chain is healthy, view available solver liquidity, solver wallet addresses, depository contracts, and optionally check route configuration between two chains.

Use this before quoting to verify a route is viable:
- Is the chain healthy and operational?
- How much solver liquidity is available?
- What are the solver EOA addresses and Relay contracts on this chain?
- Is the route between origin and destination enabled?

If a chain is unhealthy or has low liquidity, bridging may fail or be slow.`,
    {
      chainId: z
        .union([z.number(), z.string()])
        .describe("Chain to check (ID or name like 'base', 'ethereum')."),
      destinationChainId: z
        .union([z.number(), z.string()])
        .optional()
        .describe(
          "If provided, also checks route config between chainId and this destination. Use to verify a specific route is enabled."
        ),
    },
    async ({ chainId, destinationChainId }) => {
      let resolvedChainId: number;
      let resolvedDestId: number | undefined;
      try {
        if (destinationChainId !== undefined) {
          [resolvedChainId, resolvedDestId] = await Promise.all([
            resolveChainId(chainId),
            resolveChainId(destinationChainId),
          ]);
        } else {
          resolvedChainId = await resolveChainId(chainId);
        }
      } catch (err) {
        return mcpCatchError(err);
      }

      // Fetch health + liquidity + chain data in parallel, optionally route config
      let health: Awaited<ReturnType<typeof getChainHealth>>;
      let liquidity: Awaited<ReturnType<typeof getChainLiquidity>>;
      let routeConfig: Awaited<ReturnType<typeof getRouteConfig>> | null;
      let chainData: Chain | undefined;
      try {
        const [h, l, rc, chainsResp] = await Promise.all([
          getChainHealth(resolvedChainId),
          getChainLiquidity(resolvedChainId),
          resolvedDestId !== undefined
            ? getRouteConfig(resolvedChainId, resolvedDestId)
            : Promise.resolve(null),
          getChains(),
        ]);
        health = h;
        liquidity = l;
        routeConfig = rc;
        chainData = chainsResp.chains.find((c) => c.id === resolvedChainId);
      } catch (err) {
        return mcpCatchError(err);
      }

      // Slim liquidity to essentials
      const slimLiquidity = liquidity.map((entry) => ({
        symbol: entry.symbol,
        balance: entry.balance,
        amountUsd: entry.amountUsd,
      }));

      const totalLiquidityUsd = slimLiquidity.reduce(
        (sum, e) => sum + (parseFloat(e.amountUsd) || 0),
        0
      );

      const healthEmoji = health.healthy ? "✅" : "❌";
      let summary = `Chain ${resolvedChainId}: ${healthEmoji} ${health.healthy ? "Healthy" : "Unhealthy"}. Solver liquidity: $${totalLiquidityUsd.toLocaleString()} across ${slimLiquidity.length} token${slimLiquidity.length !== 1 ? "s" : ""}.`;

      if (chainData?.solverAddresses?.length) {
        summary += ` ${chainData.solverAddresses.length} solver address${chainData.solverAddresses.length !== 1 ? "es" : ""}.`;
      }

      if (routeConfig && resolvedDestId !== undefined) {
        const enabled = routeConfig.enabled !== false;
        summary += ` Route to chain ${resolvedDestId}: ${enabled ? "enabled ✅" : "disabled ❌"}.`;
      }

      const result: Record<string, unknown> = {
        chainId: resolvedChainId,
        healthy: health.healthy,
        liquidity: slimLiquidity,
        totalLiquidityUsd: totalLiquidityUsd.toFixed(2),
      };

      if (chainData?.solverAddresses?.length) {
        result.solverAddresses = chainData.solverAddresses;
      }
      if (chainData?.contracts) {
        result.contracts = chainData.contracts;
      }
      if (routeConfig !== null) {
        result.routeConfig = routeConfig;
      }

      return {
        content: [
          { type: "text", text: summary },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );
}
