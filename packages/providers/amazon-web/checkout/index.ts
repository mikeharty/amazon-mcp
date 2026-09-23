import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { money } from '../types.js';

export async function extractCheckout(page: Page) {
  const recognized = await page.locator('#checkout-review, [data-testid="checkout-review"], #subtotals-marketplace-table').count() > 0;
  const raw = await page.locator('body').evaluate(body => {
    const text = (selector: string) => body.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    const lines = Array.from(body.querySelectorAll<HTMLElement>('[data-asin], .order-summary-line-item')).map((el, index) => ({
      lineRef: el.dataset.itemId || `checkout-line-${index + 1}`,
      asin: el.dataset.asin || el.querySelector<HTMLAnchorElement>('a[href*="/dp/"]')?.href.match(/\/dp\/([A-Z0-9]{10})/i)?.[1],
      sellerId: el.dataset.sellerId || undefined,
      condition: el.dataset.condition || undefined,
      purchaseMode: el.dataset.purchaseMode || undefined,
      title: el.querySelector('.item-title, .a-truncate-cut, h4')?.textContent?.trim(),
      quantity: Number(el.querySelector('[data-quantity]')?.getAttribute('data-quantity') || el.textContent?.match(/Qty:\s*(\d+)/i)?.[1] || 1),
      priceText: el.querySelector('.a-price .a-offscreen')?.textContent?.trim(),
    })).filter(line => line.title && line.asin);
    const groups = Array.from(body.querySelectorAll<HTMLElement>('.shipment, [data-shipment-index]')).map((el, index) => ({
      groupRef: `group-${index + 1}`,
      delivery: el.querySelector('.delivery-date, .a-color-success')?.textContent?.trim(),
      speed: el.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value,
    }));
    return {
      lines,
      subtotalText: text('#subtotals-marketplace-table .a-text-right, .order-summary-line-definition'),
      totalText: text('#subtotals-marketplace-table tr:last-child .a-text-right, #orderTotalPrimaryText'),
      taxText: text('[data-testid="tax-total"], #tax-total'),
      addressRef: body.querySelector<HTMLElement>('[data-address-ref]')?.dataset.addressRef,
      paymentRef: body.querySelector<HTMLElement>('[data-payment-ref]')?.dataset.paymentRef,
      deliveryAddress: text('[data-address-ref], #shipping-address-summary, .ship-to-this-address'),
      payment: text('[data-payment-ref], #payment-information, .payment-instrument'),
      groups,
      warnings: Array.from(body.querySelectorAll('.a-alert-content')).map(el => el.textContent?.trim()).filter(Boolean),
    };
  });
  const normalized = {
    recognized,
    lines: raw.lines.map(line => ({ ...line, price: money(line.priceText), priceText: undefined })),
    subtotal: money(raw.subtotalText), tax: money(raw.taxText), total: money(raw.totalText),
    addressRef: raw.addressRef, paymentRef: raw.paymentRef,
    deliveryAddress: raw.deliveryAddress ? 'Address on file' : undefined, payment: maskPaymentSummary(raw.payment),
    shippingGroups: raw.groups, warnings: raw.warnings,
  };
  const revision = createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24);
  return { ...normalized, revision };
}

export async function prepareCheckout(page: Page, expectedRevision: string) {
  const checkout = await extractCheckout(page);
  if (checkout.revision !== expectedRevision) return { conflict: true as const, checkout };
  const termsHash = createHash('sha256').update(JSON.stringify(checkout)).digest('hex');
  return {
    conflict: false as const,
    checkout,
    termsHash,
    reviewUrl: page.url(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

function maskPaymentSummary(value?: string): string | undefined {
  if (!value) return undefined;
  const brand = value.match(/\b(Visa|Mastercard|Amex|American Express|Discover)\b/i)?.[1];
  const lastFour = value.match(/(?:ending in|last four|\*{2,})\s*(\d{4})/i)?.[1];
  return [brand, lastFour ? `ending in ${lastFour}` : undefined].filter(Boolean).join(' ') || 'Payment method on file';
}
