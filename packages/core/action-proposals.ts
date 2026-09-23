import { createHash } from "node:crypto";

export type Money = Readonly<{ currency: "USD"; amountMinor: number }>;

export type ProposalContext = Readonly<{
  proposalId: string;
  ownerId: string;
  accountRef: string;
  sessionGeneration: number;
  revision: number;
  observedAt: string;
  expiresAt: string;
  handoffUrl: string;
}>;

type ObservedBase = Readonly<{
  available: boolean;
  source: "amazon_authenticated";
}>;

export type ObservedActionOption =
  | (ObservedBase & {
      kind: "order_cancel";
      orderRef: string;
      lineRefs: readonly string[];
      requiresReason: boolean;
      allowedReasons?: readonly string[];
    })
  | (ObservedBase & {
      kind: "order_edit";
      orderRef: string;
      field: "address" | "payment" | "delivery_speed";
      currentValueRef: string;
      allowedValues: readonly Readonly<{
        valueRef: string;
        maskedLabel: string;
      }>[];
    })
  | (ObservedBase & {
      kind: "buy_again";
      orderRef: string;
      lineRef: string;
      previous: PurchasedItem;
      current: CurrentOffer;
    })
  | (ObservedBase & {
      kind: "return";
      orderRef: string;
      eligibleLines: readonly EligibleReturnLine[];
      eligibleThrough: string;
      method: Readonly<{ methodRef: string; label: string }>;
      refundDestination: Readonly<{
        destinationRef: string;
        maskedLabel: string;
      }>;
      refundAmount: Money;
      fee: Money;
    })
  | (ObservedBase & {
      kind: "replacement";
      orderRef: string;
      eligibleLines: readonly EligibleReturnLine[];
      eligibleThrough: string;
      method: Readonly<{ methodRef: string; label: string }>;
      replacement: CurrentOffer & Readonly<{ orderTotal: Money }>;
      originalReturnDeadline: string;
      contingentCharge: Money;
      fee: Money;
    })
  | (ObservedBase & {
      kind: "subscription_change";
      subscriptionRef: string;
      subscriptionRevision: number;
      item: Readonly<{ asin: string; title: string; quantity: number }>;
      action:
        | "change_frequency"
        | "change_date"
        | "skip"
        | "pause"
        | "resume"
        | "cancel";
      currentSchedule: string;
      proposedSchedule?: string;
      effectiveAt: string;
      fee: Money;
      createsImmediateOrder: false;
    });

export type PurchasedItem = Readonly<{
  asin: string;
  title: string;
  sellerRef?: string;
  quantity: number;
  unitPrice?: Money;
}>;

export type CurrentOffer = Readonly<{
  offerRef: string;
  asin: string;
  title: string;
  sellerRef: string;
  quantity: number;
  unitPrice: Money;
  availabilityObservedAt: string;
}>;

export type EligibleReturnLine = Readonly<{
  lineRef: string;
  asin: string;
  title: string;
  purchasedQuantity: number;
  eligibleQuantity: number;
  selectedQuantity: number;
}>;

export type ActionSelection =
  | Readonly<{ kind: "order_cancel"; reason?: string }>
  | Readonly<{ kind: "order_edit"; selectedValueRef: string }>
  | Readonly<{ kind: "buy_again"; quantity: number }>
  | Readonly<{
      kind: "return" | "replacement";
      lines: readonly Readonly<{ lineRef: string; quantity: number }>[];
      userReason: string;
      methodRef: string;
      refundDestinationRef?: string;
    }>
  | Readonly<{
      kind: "subscription_change";
      action: ObservedSubscriptionAction;
    }>;

export type ObservedSubscriptionAction = Extract<
  ObservedActionOption,
  { kind: "subscription_change" }
>["action"];

export type ActionProposal = Readonly<{
  proposalId: string;
  kind: ObservedActionOption["kind"];
  ownerId: string;
  accountRef: string;
  sessionGeneration: number;
  revision: number;
  executor: "owner_handoff_only";
  materialTerms: Readonly<Record<string, unknown>>;
  materialTermsDigest: string;
  reviewSummary: string;
  handoff: PrivateHandoff;
}>;

export type PrivateHandoff = Readonly<{
  url: string;
  expiresAt: string;
  access: "owner_private";
  cacheControl: "private, no-store";
}>;

export type PrepareActionInput = Readonly<{
  context: ProposalContext;
  expectedRevision: number;
  expectedSessionGeneration: number;
  observedOption: ObservedActionOption;
  selection: ActionSelection;
  now?: () => number;
  maxObservationAgeMs?: number;
  maxHandoffWindowMs?: number;
}>;

export class ProposalValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

/** `observedOption` is a trusted domain-port value. Do not expose it as caller-supplied MCP input. */
export function prepareActionProposal(
  input: PrepareActionInput,
): ActionProposal {
  const now = input.now?.() ?? Date.now();
  validateContext(
    input.context,
    input.expectedRevision,
    input.expectedSessionGeneration,
    now,
    input.maxObservationAgeMs ?? 5 * 60_000,
    input.maxHandoffWindowMs ?? 15 * 60_000,
  );
  if (!input.observedOption.available)
    fail("action_unavailable", "The observed action is unavailable");
  if (input.selection.kind !== input.observedOption.kind)
    fail("selection_mismatch", "Selection does not match observed action");

  const materialTerms = buildMaterialTerms(
    input.observedOption,
    input.selection,
    input.context.revision,
    now,
  );
  const copiedTerms = structuredClone(materialTerms);
  const digestInput = {
    ownerId: input.context.ownerId,
    accountRef: input.context.accountRef,
    sessionGeneration: input.context.sessionGeneration,
    revision: input.context.revision,
    expiresAt: input.context.expiresAt,
    kind: input.observedOption.kind,
    materialTerms: copiedTerms,
  };
  return Object.freeze({
    proposalId: requiredRef(input.context.proposalId, "proposalId"),
    kind: input.observedOption.kind,
    ownerId: requiredRef(input.context.ownerId, "ownerId"),
    accountRef: requiredRef(input.context.accountRef, "accountRef"),
    sessionGeneration: input.context.sessionGeneration,
    revision: input.context.revision,
    executor: "owner_handoff_only",
    materialTerms: copiedTerms,
    materialTermsDigest: createHash("sha256")
      .update(stableSerialize(digestInput))
      .digest("hex"),
    reviewSummary: summarize(input.observedOption, copiedTerms),
    handoff: privateHandoff(input.context),
  });
}

export type DraftContext = Readonly<{
  proposalId: string;
  ownerId: string;
  accountRef: string;
  expiresAt: string;
  handoffUrl: string;
}>;

export type DraftHandoff = Readonly<{
  proposalId: string;
  kind: "product_review" | "seller_feedback" | "support_contact";
  destinationRef: string;
  userText: string;
  executor: "owner_handoff_only";
  handoff: PrivateHandoff;
}>;

export function prepareUserDraft(
  input: Readonly<{
    context: DraftContext;
    kind: DraftHandoff["kind"];
    destinationRef: string;
    userText: string;
    now?: () => number;
    maxHandoffWindowMs?: number;
  }>,
): DraftHandoff {
  requiredRef(input.context.proposalId, "proposalId");
  requiredRef(input.context.ownerId, "ownerId");
  requiredRef(input.context.accountRef, "accountRef");
  requiredRef(input.destinationRef, "destinationRef");
  if (!input.userText || input.userText.length > 10_000)
    fail("invalid_user_text", "User text must be 1 to 10000 characters");
  const now = input.now?.() ?? Date.now();
  const expiresAt = validateHandoff(
    input.context.handoffUrl,
    input.context.expiresAt,
  );
  if (
    expiresAt <= now ||
    expiresAt - now > (input.maxHandoffWindowMs ?? 15 * 60_000)
  ) {
    fail(
      "invalid_expiry",
      "Draft handoff expiry is outside the allowed window",
    );
  }

  return Object.freeze({
    proposalId: input.context.proposalId,
    kind: input.kind,
    destinationRef: input.destinationRef,
    userText: input.userText,
    executor: "owner_handoff_only",
    handoff: privateHandoff(input.context),
  });
}

function buildMaterialTerms(
  option: ObservedActionOption,
  selection: ActionSelection,
  contextRevision: number,
  now: number,
): Record<string, unknown> {
  switch (option.kind) {
    case "order_cancel": {
      const chosen = selection as Extract<
        ActionSelection,
        { kind: "order_cancel" }
      >;
      if (option.requiresReason && !chosen.reason)
        fail("reason_required", "Amazon requires a cancellation reason");
      if (
        chosen.reason &&
        option.allowedReasons &&
        !option.allowedReasons.includes(chosen.reason)
      ) {
        fail("invalid_reason", "Cancellation reason is not an observed option");
      }
      return {
        orderRef: requiredRef(option.orderRef, "orderRef"),
        lineRefs: nonEmptyUnique(option.lineRefs, "lineRefs"),
        reason: chosen.reason,
      };
    }
    case "order_edit": {
      const chosen = selection as Extract<
        ActionSelection,
        { kind: "order_edit" }
      >;
      const selected = option.allowedValues.find(
        (value) => value.valueRef === chosen.selectedValueRef,
      );
      if (!selected)
        fail(
          "invalid_edit_value",
          "Selected order edit is not an observed option",
        );
      return {
        orderRef: requiredRef(option.orderRef, "orderRef"),
        field: option.field,
        fromValueRef: requiredRef(option.currentValueRef, "currentValueRef"),
        toValueRef: requiredRef(selected.valueRef, "selectedValueRef"),
        maskedLabel: requiredRef(selected.maskedLabel, "maskedLabel"),
      };
    }
    case "buy_again": {
      const chosen = selection as Extract<
        ActionSelection,
        { kind: "buy_again" }
      >;
      positiveInteger(chosen.quantity, "quantity");
      validatePurchasedItem(option.previous);
      validateCurrentOffer(option.current);
      return {
        orderRef: requiredRef(option.orderRef, "orderRef"),
        lineRef: requiredRef(option.lineRef, "lineRef"),
        quantity: chosen.quantity,
        previous: option.previous,
        current: { ...option.current, quantity: chosen.quantity },
        delta: {
          variantChanged: option.previous.asin !== option.current.asin,
          sellerChanged: option.previous.sellerRef !== option.current.sellerRef,
          unitPriceDeltaMinor:
            option.previous.unitPrice?.currency ===
            option.current.unitPrice.currency
              ? option.current.unitPrice.amountMinor -
                option.previous.unitPrice.amountMinor
              : undefined,
        },
      };
    }
    case "return": {
      const chosen = selection as Extract<
        ActionSelection,
        { lines: readonly unknown[] }
      >;
      const lines = validateReturnSelection(option, chosen);
      if (
        chosen.refundDestinationRef !== option.refundDestination.destinationRef
      ) {
        fail(
          "refund_destination_mismatch",
          "Refund destination does not match observed option",
        );
      }
      validateMoney(option.refundAmount, "refundAmount");
      validateMoney(option.fee, "fee");
      if (requiredInstant(option.eligibleThrough, "eligibleThrough") <= now) {
        fail("return_eligibility_expired", "Return eligibility has expired");
      }
      return {
        orderRef: requiredRef(option.orderRef, "orderRef"),
        lines,
        userReason: requiredUserReason(chosen.userReason),
        method: option.method,
        eligibleThrough: option.eligibleThrough,
        refundDestination: option.refundDestination,
        refundAmount: option.refundAmount,
        fee: option.fee,
      };
    }
    case "replacement": {
      const chosen = selection as Extract<
        ActionSelection,
        { lines: readonly unknown[] }
      >;
      const lines = validateReturnSelection(option, chosen);
      validateCurrentOffer(option.replacement);
      validateMoney(option.replacement.orderTotal, "replacement.orderTotal");
      validateMoney(option.contingentCharge, "contingentCharge");
      validateMoney(option.fee, "fee");
      if (requiredInstant(option.eligibleThrough, "eligibleThrough") <= now) {
        fail(
          "return_eligibility_expired",
          "Replacement eligibility has expired",
        );
      }
      if (
        requiredInstant(
          option.originalReturnDeadline,
          "originalReturnDeadline",
        ) <= now
      ) {
        fail(
          "return_deadline_expired",
          "Original-item return deadline has expired",
        );
      }
      return {
        orderRef: requiredRef(option.orderRef, "orderRef"),
        lines,
        userReason: requiredUserReason(chosen.userReason),
        method: option.method,
        eligibleThrough: option.eligibleThrough,
        replacement: option.replacement,
        originalReturnDeadline: option.originalReturnDeadline,
        contingentCharge: option.contingentCharge,
        fee: option.fee,
      };
    }
    case "subscription_change": {
      const chosen = selection as Extract<
        ActionSelection,
        { kind: "subscription_change" }
      >;
      if (chosen.action !== option.action)
        fail(
          "subscription_action_mismatch",
          "Subscription action was not observed",
        );
      if (
        option.subscriptionRevision < 0 ||
        !Number.isSafeInteger(option.subscriptionRevision)
      ) {
        fail(
          "invalid_subscription_revision",
          "Subscription revision is invalid",
        );
      }
      if (option.subscriptionRevision !== contextRevision)
        fail("stale_revision", "Subscription revision changed");
      if (
        (option.action === "change_frequency" ||
          option.action === "change_date") &&
        !option.proposedSchedule
      ) {
        fail("schedule_required", "The proposed schedule is required");
      }
      if (option.createsImmediateOrder !== false)
        fail(
          "immediate_order_unsupported",
          "Immediate subscription orders are unsupported",
        );
      validateMoney(option.fee, "fee");
      positiveInteger(option.item.quantity, "item.quantity");
      requiredInstant(option.effectiveAt, "effectiveAt");
      return {
        subscriptionRef: requiredRef(option.subscriptionRef, "subscriptionRef"),
        subscriptionRevision: option.subscriptionRevision,
        item: option.item,
        action: option.action,
        currentSchedule: requiredRef(option.currentSchedule, "currentSchedule"),
        proposedSchedule: option.proposedSchedule,
        effectiveAt: option.effectiveAt,
        fee: option.fee,
        createsImmediateOrder: false,
      };
    }
  }
}

function validateReturnSelection(
  option: Extract<ObservedActionOption, { kind: "return" | "replacement" }>,
  selection: Extract<ActionSelection, { lines: readonly unknown[] }>,
) {
  if (selection.methodRef !== option.method.methodRef)
    fail(
      "return_method_mismatch",
      "Return method does not match observed option",
    );
  requiredUserReason(selection.userReason);
  const eligible = new Map(
    option.eligibleLines.map((line) => [line.lineRef, line]),
  );
  const selectedRefs = new Set(selection.lines.map((line) => line.lineRef));
  if (
    eligible.size !== option.eligibleLines.length ||
    selection.lines.length === 0 ||
    selectedRefs.size !== selection.lines.length ||
    selectedRefs.size !== eligible.size
  ) {
    fail("invalid_return_lines", "Return lines are empty or ambiguous");
  }
  for (const line of option.eligibleLines) {
    requiredRef(line.lineRef, "lineRef");
    requiredRef(line.asin, "asin");
    requiredRef(line.title, "title");
    positiveInteger(line.purchasedQuantity, "purchasedQuantity");
    positiveInteger(line.eligibleQuantity, "eligibleQuantity");
    positiveInteger(line.selectedQuantity, "selectedQuantity");
    if (
      line.eligibleQuantity > line.purchasedQuantity ||
      line.selectedQuantity > line.eligibleQuantity
    ) {
      fail(
        "invalid_return_quantity",
        "Observed return quantities are inconsistent",
      );
    }
  }
  return selection.lines.map((selected) => {
    const line = eligible.get(selected.lineRef);
    if (!line || selected.quantity !== line.selectedQuantity) {
      fail(
        "invalid_return_quantity",
        "Return quantity does not match the observed quote",
      );
    }
    return { ...line, quantity: selected.quantity };
  });
}

function validateContext(
  context: ProposalContext,
  expectedRevision: number,
  expectedSessionGeneration: number,
  now: number,
  maxObservationAgeMs: number,
  maxHandoffWindowMs: number,
): void {
  requiredRef(context.proposalId, "proposalId");
  requiredRef(context.ownerId, "ownerId");
  requiredRef(context.accountRef, "accountRef");
  nonNegativeInteger(context.revision, "revision");
  nonNegativeInteger(context.sessionGeneration, "sessionGeneration");
  nonNegativeInteger(expectedRevision, "expectedRevision");
  nonNegativeInteger(expectedSessionGeneration, "expectedSessionGeneration");
  positiveInteger(maxObservationAgeMs, "maxObservationAgeMs");
  positiveInteger(maxHandoffWindowMs, "maxHandoffWindowMs");
  if (context.revision !== expectedRevision)
    fail("stale_revision", "Observed revision changed");
  if (context.sessionGeneration !== expectedSessionGeneration)
    fail("stale_session", "Amazon session generation changed");
  const observedAt = requiredInstant(context.observedAt, "observedAt");
  const expiresAt = validateHandoff(context.handoffUrl, context.expiresAt);
  if (observedAt > now || now - observedAt > maxObservationAgeMs) {
    fail(
      "stale_observation",
      "Observed action evidence is stale or future-dated",
    );
  }
  if (expiresAt <= now || expiresAt - now > maxHandoffWindowMs) {
    fail("invalid_expiry", "Proposal expiry is outside the allowed window");
  }
  if (expiresAt <= observedAt)
    fail("invalid_expiry", "Proposal must expire after its observation");
}

function validateHandoff(rawUrl: string, expiresAt: string): number {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("invalid_handoff_url", "Handoff URL is invalid");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "amazon.com" && !hostname.endsWith(".amazon.com")) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    fail(
      "invalid_handoff_url",
      "Handoff URL must be an uncredentialed Amazon HTTPS URL",
    );
  }
  return requiredInstant(expiresAt, "expiresAt");
}

function privateHandoff(context: DraftContext): PrivateHandoff {
  return Object.freeze({
    url: context.handoffUrl,
    expiresAt: context.expiresAt,
    access: "owner_private",
    cacheControl: "private, no-store",
  });
}

function validatePurchasedItem(item: PurchasedItem): void {
  requiredRef(item.asin, "previous.asin");
  requiredRef(item.title, "previous.title");
  positiveInteger(item.quantity, "previous.quantity");
  if (item.unitPrice) validateMoney(item.unitPrice, "previous.unitPrice");
}

function validateCurrentOffer(offer: CurrentOffer): void {
  requiredRef(offer.offerRef, "offerRef");
  requiredRef(offer.asin, "asin");
  requiredRef(offer.title, "title");
  requiredRef(offer.sellerRef, "sellerRef");
  positiveInteger(offer.quantity, "quantity");
  validateMoney(offer.unitPrice, "unitPrice");
  requiredInstant(offer.availabilityObservedAt, "availabilityObservedAt");
}

function validateMoney(money: Money, name: string): void {
  if (
    money.currency !== "USD" ||
    !Number.isSafeInteger(money.amountMinor) ||
    money.amountMinor < 0
  ) {
    fail("invalid_money", `${name} must be non-negative USD minor units`);
  }
}

function summarize(
  option: ObservedActionOption,
  terms: Record<string, unknown>,
): string {
  switch (option.kind) {
    case "order_cancel":
      return `Review cancellation for order ${option.orderRef}.`;
    case "order_edit":
      return `Review ${option.field.replace("_", " ")} change for order ${option.orderRef}.`;
    case "buy_again":
      return `Review current offer before buying ${String((terms.current as CurrentOffer).title)} again.`;
    case "return":
      return `Review return, refund, fees, and method for order ${option.orderRef}.`;
    case "replacement":
      return `Review replacement, return deadline, fees, and contingent charge for order ${option.orderRef}.`;
    case "subscription_change":
      return `Review ${option.action.replace("_", " ")} for subscription ${option.subscriptionRef}.`;
  }
}

function requiredRef(value: string, name: string): string {
  if (!value || value.length > 512)
    fail("invalid_reference", `${name} is required`);
  return value;
}

function requiredUserReason(value: string): string {
  if (!value || value.length > 2_000)
    fail("reason_required", "User reason is required");
  return value;
}

function requiredInstant(value: string, name: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    fail("invalid_timestamp", `${name} must be an ISO timestamp`);
  return milliseconds;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    fail("invalid_quantity", `${name} must be a positive integer`);
}

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    fail("invalid_revision", `${name} must be a non-negative safe integer`);
}

function nonEmptyUnique(values: readonly string[], name: string): string[] {
  if (values.length === 0 || new Set(values).size !== values.length)
    fail("invalid_reference", `${name} must be non-empty and unique`);
  return values.map((value) => requiredRef(value, name));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fail(code: string, message: string): never {
  throw new ProposalValidationError(code, message);
}
