import { randomUUID } from "node:crypto";
import type { ProviderContext, Result } from "../contracts/index.js";
import { digest } from "../store/crypto.js";

export type ObservationProvenance = {
  marketplace: "amazon.com";
  asin: string;
  sessionGeneration: number | null;
  source: string;
  sourceObservedAt: string | null;
  providerContextRef: string | null;
  contextRef: string;
  deliveryContext:
    { status: "observed"; ref: string } | { status: "unverified" };
  productIdentityVerified: boolean;
  quoteEligible: false;
};
/** Stable lookup identity. Individual contexts/provenance remain attached to each point. */
export function productHistorySubject(
  marketplace: "amazon.com",
  asin: string,
): string {
  return digest({ version: 2, kind: "products_get", marketplace, asin });
}
export function productObservationProvenance(
  ctx: ProviderContext,
  asin: string,
  result: Result,
): ObservationProvenance {
  const delivery = result.observation?.deliveryContextRef;
  return {
    marketplace: ctx.marketplace,
    asin,
    sessionGeneration: ctx.sessionGeneration,
    source: result.observation?.source ?? "unrecorded-provider",
    sourceObservedAt: result.observation?.observedAt ?? null,
    providerContextRef: result.observation?.contextRef ?? null,
    contextRef: delivery
      ? digest({
          owner: ctx.ownerId,
          account: ctx.accountRef,
          marketplace: ctx.marketplace,
          source: result.observation?.source,
          delivery,
        })
      : `unverified:${randomUUID()}`,
    deliveryContext: delivery
      ? { status: "observed", ref: delivery }
      : { status: "unverified" },
    productIdentityVerified: true,
    quoteEligible: false,
  };
}
