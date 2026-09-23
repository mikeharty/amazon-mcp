import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import type { ProviderContext } from '../packages/contracts/index.js';
import { AmazonWebProvider } from '../packages/providers/amazon-web/provider.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ctx: ProviderContext = { ownerId: 'owner-test', accountRef: 'account-test', sessionGeneration: 1, marketplace: 'amazon.com' };
let browser: Browser;
let context: BrowserContext;
let page: Page;
let provider: AmazonWebProvider;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  page = await context.newPage();
  await page.route('https://www.amazon.com/**', routeFixture);
  provider = new AmazonWebProvider({ run: fn => fn(page), close: async () => {} });
});
afterAll(async () => { await browser?.close(); });

describe('Amazon web provider synthetic fixture E2E', () => {
  it('rejects work from a stale persisted browser generation', async () => {
    const guarded = new AmazonWebProvider({ sessionGeneration: 2, run: fn => fn(page), close: async () => {} });
    const result = await guarded.read('cart_get', {}, ctx);
    expect(result).toMatchObject({ status: 'conflict', error: { code: 'stale_session_generation', retryable: true } });
  });

  it('extracts public product, search, offer, review, and media facts', async () => {
    const search = await provider.read('products_search', { query: 'mug' }, ctx);
    expect(search.status).toBe('partial');
    expect((search.data as any).items[0]).toMatchObject({ asin: 'B0FIXTURE1', title: 'Fixture Travel Mug', price: { currency: 'USD', minorUnits: 2450 } });
    const product = await provider.read('products_get', { asin: 'B0FIXTURE1' }, ctx);
    expect(product.status).toBe('ok');
    expect(product.data).toMatchObject({ asin: 'B0FIXTURE1', rating: 4.6, attributes: { Capacity: '16 oz' } });
    const offers = await provider.read('offers_list', { asin: 'B0FIXTURE1' }, ctx);
    expect((offers.data as any).offers[0]).toMatchObject({ sellerId: 'A1FIXTURE', condition: 'New', price: { minorUnits: 2450 } });
    const reviews = await provider.read('product_reviews_list', { asin: 'B0FIXTURE1' }, ctx);
    expect((reviews.data as any).reviews[0]).toMatchObject({ id: 'R1', verified: true, rating: 5 });
    const media = await provider.read('product_media_list', { asin: 'B0FIXTURE1' }, ctx);
    expect((media.data as any).media[0].url).toContain('m.media-amazon.com');
    const variants = await provider.read('products_variants', { asin: 'B0FIXTURE1' }, ctx);
    expect((variants.data as any).variants).toHaveLength(2);
    const related = await provider.read('products_related', { asin: 'B0FIXTURE1' }, ctx);
    expect((related.data as any).items[0]).toMatchObject({ asin: 'B0RELATED1', relation: 'page_carousel' });
    const seller = await provider.read('sellers_get', { sellerId: 'A1FIXTURE' }, ctx);
    expect(seller.data).toMatchObject({ sellerId: 'A1FIXTURE', name: 'Fixture Seller' });
    const feedback = await provider.read('seller_feedback_list', { sellerId: 'A1FIXTURE' }, ctx);
    expect((feedback.data as any).feedback[0]).toMatchObject({ id: 'F1', rating: '5' });
    const deals = await provider.read('deals_search', {}, ctx);
    expect((deals.data as any).deals[0]).toMatchObject({ dealRef: 'D1', discount: '20% off', membershipRequired: true, price: { minorUnits: 1950 } });
  });

  it('extracts cart, order, shipment, subscription, and exact checkout terms', async () => {
    const cart = await provider.read('cart_get', {}, ctx);
    expect(cart.status).toBe('ok');
    expect((cart.data as any).lines[0]).toMatchObject({ lineRef: 'cart-line-1', quantity: 1, selected: true });
    const orders = await provider.read('orders_list', {}, ctx);
    expect((orders.data as any).orders[0]).toMatchObject({ orderId: '111-2222222-3333333', total: { minorUnits: 2450 } });
    const shipment = await provider.read('shipments_get', { orderId: '111-2222222-3333333' }, ctx);
    expect((shipment.data as any).shipments[0]).toMatchObject({ shipmentRef: 'ship-1', status: 'Delivered' });
    const wrongOrder = await provider.read('orders_get', { orderId: '999-9999999-9999999' }, ctx);
    expect(wrongOrder).toMatchObject({ status: 'partial', coverage: { missing: expect.arrayContaining(['required:order_identity']) } });
    expect((wrongOrder.data as any).orderId).toBeUndefined();
    const subscriptions = await provider.read('subscriptions_list', {}, ctx);
    expect((subscriptions.data as any).subscriptions[0]).toMatchObject({ subscriptionRef: 'sub-1', estimatedPrice: { minorUnits: 1875 } });
    const checkout = await provider.read('checkout_get', { url: 'https://www.amazon.com/checkout/p/review' }, ctx);
    const prepared = await provider.read('checkout_prepare', { url: 'https://www.amazon.com/checkout/p/review', expectedRevision: (checkout.data as any).revision }, ctx);
    expect(prepared.status).toBe('ok');
    expect((prepared.data as any)).toMatchObject({ termsHash: expect.stringMatching(/^[a-f0-9]{64}$/), checkout: { total: { minorUnits: 2675 } } });
    expect(JSON.stringify(prepared.data)).not.toContain('98101');
    const unsafeCheckout = await provider.read('checkout_get', { url: 'https://www.amazon.com/checkout/p/submit?token=secret' }, ctx);
    expect(unsafeCheckout).toMatchObject({ status: 'failed', error: { code: 'invalid_input' } });
  });

  it('rejects stale cart revisions and wrong sellers', async () => {
    const stale = await provider.mutate('cart_remove', { lineRef: 'cart-line-1', expectedRevision: 'old' }, ctx);
    expect(stale).toMatchObject({ status: 'conflict', error: { code: 'stale_cart' } });
    const cart = await provider.read('cart_get', {}, ctx);
    const wrongSeller = await provider.mutate('cart_add', { asin: 'B0FIXTURE1', quantity: 1, expectedRevision: (cart.data as any).revision, expectedSellerId: 'A1OTHER', expectedCondition: 'New', purchaseMode: 'one_time' }, ctx);
    expect(wrongSeller).toMatchObject({ status: 'conflict', error: { code: 'wrong_seller' } });
  });

  it('verifies reversible cart quantity/removal and quarantines an unverifiable add', async () => {
    const initial = await provider.read('cart_get', {}, ctx);
    const changed = await provider.mutate('cart_set_quantity', { lineRef: 'cart-line-1', quantity: 2, expectedRevision: (initial.data as any).revision }, ctx);
    expect(changed.status).toBe('ok');
    expect((changed.data as any).lines[0].quantity).toBe(2);
    const reloaded = await provider.read('cart_get', {}, ctx);
    const removed = await provider.mutate('cart_remove', { lineRef: 'cart-line-1', expectedRevision: (reloaded.data as any).revision }, ctx);
    expect(removed.status).toBe('ok');

    let productSeen = false;
    const failureContext = await browser.newContext();
    const failurePage = await failureContext.newPage();
    await failurePage.route('https://www.amazon.com/**', async route => {
      if (new URL(route.request().url()).pathname.startsWith('/dp/')) { productSeen = true; return route.fulfill({ status: 200, contentType: 'text/html', body: await readFile(join(fixtures, 'product.html'), 'utf8') }); }
      if (productSeen && new URL(route.request().url()).pathname.includes('/cart/')) return route.abort('failed');
      return routeFixture(route);
    });
    const failureProvider = new AmazonWebProvider({ run: fn => fn(failurePage), close: async () => {} });
    const startingCart = await failureProvider.read('cart_get', {}, ctx);
    const unknown = await failureProvider.mutate('cart_add', { asin: 'B0FIXTURE1', quantity: 1, expectedRevision: (startingCart.data as any).revision, expectedSellerId: 'A1FIXTURE', expectedCondition: 'New', purchaseMode: 'one_time' }, ctx);
    expect(unknown).toMatchObject({ status: 'outcome_unknown', error: { retryable: false } });
    await failureContext.close();
  });

  it('verifies a cart move by observing the destination list', async () => {
    const initial = await provider.read('cart_get', {}, ctx);
    const moved = await provider.mutate('cart_move', { lineRef: 'cart-line-1', expectedRevision: (initial.data as any).revision, destination: 'save_for_later' }, ctx);
    expect(moved.status).toBe('ok');
    expect((moved.data as any).lines[0]).toMatchObject({ lineRef: 'cart-line-1', location: 'saved' });
  });
});

async function routeFixture(route: Route) {
  const path = new URL(route.request().url()).pathname;
  const file = path === '/s' ? 'search.html'
    : path.startsWith('/dp/') ? 'product.html'
    : path.includes('offer-listing') ? 'offers.html'
    : path.includes('product-reviews') ? 'reviews.html'
    : path.includes('/cart/') ? 'cart.html'
    : path.includes('order') ? 'orders.html'
    : path.includes('subscribe-and-save') ? 'subscriptions.html'
    : path === '/sp' ? 'seller.html'
    : path === '/deals' ? 'deals.html'
    : path.startsWith('/checkout') ? 'checkout.html' : undefined;
  if (!file) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: 'text/html', body: await readFile(join(fixtures, file), 'utf8') });
}
