import { describe, expect, it } from 'vitest';

import {
  prepareActionProposal,
  prepareUserDraft,
  ProposalValidationError,
  type ObservedActionOption,
  type ProposalContext,
} from '../packages/core/action-proposals.js';

const context: ProposalContext = {
  proposalId: 'proposal-1',
  ownerId: 'owner-1',
  accountRef: 'account-1',
  sessionGeneration: 3,
  revision: 7,
  observedAt: '2026-09-22T20:00:00.000Z',
  expiresAt: '2026-09-22T20:15:00.000Z',
  handoffUrl: 'https://www.amazon.com/gp/your-account/order-details?orderID=123',
};

describe('action proposal preparation', () => {
  it('preserves the actual cancellation reason and binds revision, session, and private handoff', () => {
    const proposal = prepareActionProposal({
      context,
      expectedRevision: 7,
      expectedSessionGeneration: 3,
      observedOption: {
        kind: 'order_cancel',
        available: true,
        source: 'amazon_authenticated',
        orderRef: 'order-1',
        lineRefs: ['line-1'],
        requiresReason: true,
        allowedReasons: ['Ordered by mistake', 'Arrives too late'],
      },
      selection: { kind: 'order_cancel', reason: 'Arrives too late' },
    });

    expect(proposal.materialTerms).toEqual({
      orderRef: 'order-1',
      lineRefs: ['line-1'],
      reason: 'Arrives too late',
    });
    expect(proposal).toEqual(
      expect.objectContaining({
        executor: 'owner_handoff_only',
        revision: 7,
        sessionGeneration: 3,
        materialTermsDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(proposal.handoff).toEqual(
      expect.objectContaining({ access: 'owner_private', cacheControl: 'private, no-store' }),
    );
  });

  it('rejects incomplete evidence, stale context, and selection not present in observed options', () => {
    const observedOption: ObservedActionOption = {
      kind: 'order_edit',
      available: true,
      source: 'amazon_authenticated',
      orderRef: 'order-1',
      field: 'delivery_speed',
      currentValueRef: 'standard',
      allowedValues: [{ valueRef: 'express', maskedLabel: 'Express, Tue' }],
    };

    expectProposalError(
      () =>
        prepareActionProposal({
          context,
          expectedRevision: 6,
          expectedSessionGeneration: 3,
          observedOption,
          selection: { kind: 'order_edit', selectedValueRef: 'express' },
        }),
      'stale_revision',
    );
    expectProposalError(
      () =>
        prepareActionProposal({
          context,
          expectedRevision: 7,
          expectedSessionGeneration: 3,
          observedOption,
          selection: { kind: 'order_edit', selectedValueRef: 'overnight' },
        }),
      'invalid_edit_value',
    );
  });

  it('shows current buy-again seller and price changes instead of reusing old terms', () => {
    const proposal = prepareActionProposal({
      context,
      expectedRevision: 7,
      expectedSessionGeneration: 3,
      observedOption: {
        kind: 'buy_again',
        available: true,
        source: 'amazon_authenticated',
        orderRef: 'order-1',
        lineRef: 'line-1',
        previous: {
          asin: 'B00M0QVG3W', title: 'Camera', sellerRef: 'seller-old', quantity: 1,
          unitPrice: { currency: 'USD', amountMinor: 2999 },
        },
        current: {
          offerRef: 'offer-current', asin: 'B00M0QVG3W', title: 'Camera', sellerRef: 'seller-new', quantity: 1,
          unitPrice: { currency: 'USD', amountMinor: 3499 }, availabilityObservedAt: context.observedAt,
        },
      },
      selection: { kind: 'buy_again', quantity: 2 },
    });

    expect(proposal.materialTerms.delta).toEqual({
      variantChanged: false,
      sellerChanged: true,
      unitPriceDeltaMinor: 500,
    });
    expect((proposal.materialTerms.current as { quantity: number }).quantity).toBe(2);
  });

  it('requires exact return money, method, destination, reason, and eligible quantities', () => {
    const observedOption: ObservedActionOption = {
      kind: 'return',
      available: true,
      source: 'amazon_authenticated',
      orderRef: 'order-1',
      eligibleLines: [{ lineRef: 'line-1', asin: 'B00M0QVG3W', title: 'Camera', purchasedQuantity: 2, eligibleQuantity: 1 }],
      eligibleThrough: '2026-10-01T07:00:00.000Z',
      method: { methodRef: 'ups-dropoff', label: 'UPS Store drop-off' },
      refundDestination: { destinationRef: 'visa-1234', maskedLabel: 'Visa ending 1234' },
      refundAmount: { currency: 'USD', amountMinor: 2999 },
      fee: { currency: 'USD', amountMinor: 0 },
    };

    const proposal = prepareActionProposal({
      context,
      expectedRevision: 7,
      expectedSessionGeneration: 3,
      observedOption,
      selection: {
        kind: 'return', lines: [{ lineRef: 'line-1', quantity: 1 }], userReason: 'Lens was scratched',
        methodRef: 'ups-dropoff', refundDestinationRef: 'visa-1234',
      },
    });
    expect(proposal.materialTerms).toEqual(expect.objectContaining({
      userReason: 'Lens was scratched',
      refundAmount: { currency: 'USD', amountMinor: 2999 },
      fee: { currency: 'USD', amountMinor: 0 },
    }));

    expectProposalError(
      () => prepareActionProposal({
        context, expectedRevision: 7, expectedSessionGeneration: 3, observedOption,
        selection: {
          kind: 'return', lines: [{ lineRef: 'line-1', quantity: 2 }], userReason: 'Lens was scratched',
          methodRef: 'ups-dropoff', refundDestinationRef: 'visa-1234',
        },
      }),
      'invalid_return_quantity',
    );
  });

  it('surfaces replacement contingent charges and validates subscription revisions', () => {
    const replacement = prepareActionProposal({
      context,
      expectedRevision: 7,
      expectedSessionGeneration: 3,
      observedOption: {
        kind: 'replacement', available: true, source: 'amazon_authenticated', orderRef: 'order-1',
        eligibleLines: [{ lineRef: 'line-1', asin: 'B00M0QVG3W', title: 'Camera', purchasedQuantity: 1, eligibleQuantity: 1 }],
        eligibleThrough: '2026-10-01T07:00:00.000Z', method: { methodRef: 'ups', label: 'UPS' },
        replacement: {
          offerRef: 'replacement-1', asin: 'B00M0QVG3W', title: 'Camera', sellerRef: 'amazon', quantity: 1,
          unitPrice: { currency: 'USD', amountMinor: 0 }, availabilityObservedAt: context.observedAt,
          orderTotal: { currency: 'USD', amountMinor: 0 },
        },
        originalReturnDeadline: '2026-10-15T07:00:00.000Z',
        contingentCharge: { currency: 'USD', amountMinor: 3499 }, fee: { currency: 'USD', amountMinor: 0 },
      },
      selection: {
        kind: 'replacement', lines: [{ lineRef: 'line-1', quantity: 1 }], userReason: 'Arrived damaged', methodRef: 'ups',
      },
    });
    expect(replacement.materialTerms).toEqual(expect.objectContaining({
      originalReturnDeadline: '2026-10-15T07:00:00.000Z',
      contingentCharge: { currency: 'USD', amountMinor: 3499 },
    }));

    expectProposalError(
      () => prepareActionProposal({
        context,
        expectedRevision: 7,
        expectedSessionGeneration: 3,
        observedOption: {
          kind: 'subscription_change', available: true, source: 'amazon_authenticated',
          subscriptionRef: 'sub-1', subscriptionRevision: 6,
          item: { asin: 'B00M0QVG3W', title: 'Coffee', quantity: 1 }, action: 'skip',
          currentSchedule: 'Every month', effectiveAt: '2026-10-01T07:00:00.000Z',
          fee: { currency: 'USD', amountMinor: 0 }, createsImmediateOrder: false,
        },
        selection: { kind: 'subscription_change', action: 'skip' },
      }),
      'stale_revision',
    );
  });

  it('preserves user draft text byte-for-byte and rejects non-Amazon handoff URLs', () => {
    const userText = 'Package arrived dented.\nPlease help — do not rewrite this.';
    const draft = prepareUserDraft({
      context: {
        proposalId: 'draft-1', ownerId: 'owner-1', accountRef: 'account-1',
        expiresAt: context.expiresAt, handoffUrl: 'https://www.amazon.com/hz/contact-us',
      },
      kind: 'support_contact',
      destinationRef: 'order-1',
      userText,
    });
    expect(draft.userText).toBe(userText);
    expect(draft).not.toHaveProperty('observedAt');
    expect(draft.handoff.access).toBe('owner_private');

    expectProposalError(
      () => prepareUserDraft({
        context: {
          proposalId: 'draft-2', ownerId: 'owner-1', accountRef: 'account-1',
          expiresAt: context.expiresAt, handoffUrl: 'https://amazon.com.evil.example/contact',
        },
        kind: 'support_contact', destinationRef: 'order-1', userText,
      }),
      'invalid_handoff_url',
    );
  });
});

function expectProposalError(callback: () => unknown, code: string): void {
  try {
    callback();
    throw new Error('Expected proposal validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProposalValidationError);
    expect((error as ProposalValidationError).code).toBe(code);
  }
}
