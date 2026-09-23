import type { Page } from 'playwright';
import { asinFrom, money } from '../types.js';

export async function extractDeals(page: Page) {
  const deals = await page.locator('[data-testid="deal-card"], [data-deal-id], .DealGridItem-module__dealItem').evaluateAll(nodes => nodes.map((node, index) => {
    const root = node as HTMLElement;
    const link = root.querySelector<HTMLAnchorElement>('a[href]');
    const text = root.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      dealRef: root.dataset.dealId || `deal-${index + 1}`,
      asin: root.dataset.asin || (link ? link.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] : undefined),
      title: root.querySelector('img')?.alt || root.querySelector('h2, h3')?.textContent?.trim(),
      url: link?.href,
      priceText: root.querySelector('.a-price .a-offscreen')?.textContent?.trim(),
      discountText: root.querySelector('[data-testid="discount"], .discount, .a-size-mini')?.textContent?.trim(),
      membershipRequired: /prime exclusive|prime member/i.test(text),
    };
  }));
  return { deals: deals.filter(item => item.title || item.asin).map(item => ({ ...item, asin: asinFrom(item.asin), price: money(item.priceText), discount: item.discountText?.match(/\d{1,3}%\s*off/i)?.[0], priceText: undefined, discountText: undefined })) };
}
