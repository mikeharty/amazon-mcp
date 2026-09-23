import type { Page } from 'playwright';
import { asinFrom, integer, money, rating } from '../types.js';

export async function extractSearch(page: Page) {
  const items = await page.locator('[data-component-type="s-search-result"][data-asin]').evaluateAll(nodes => nodes.map(node => {
    const root = node as HTMLElement;
    const link = root.querySelector<HTMLAnchorElement>('h2 a, a.a-link-normal.s-no-outline');
    return {
      asin: root.dataset.asin || undefined,
      title: root.querySelector('h2 span')?.textContent?.trim() || link?.textContent?.trim() || undefined,
      url: link?.href,
      priceText: root.querySelector('.a-price .a-offscreen')?.textContent?.trim(),
      ratingText: root.querySelector('.a-icon-alt')?.textContent?.trim(),
      reviewCountText: root.querySelector('[aria-label$=" ratings"], .s-underline-text')?.textContent?.trim(),
      sponsored: /sponsored/i.test(root.textContent || ''),
    };
  }));
  return items.filter(item => item.asin && item.title).map(item => ({
    asin: item.asin!, title: item.title!, url: item.url,
    price: money(item.priceText), rating: rating(item.ratingText), reviewCount: integer(item.reviewCountText), sponsored: item.sponsored,
  }));
}

export async function extractProduct(page: Page) {
  const raw = await page.locator('body').evaluate(body => {
    const text = (selector: string) => body.querySelector(selector)?.textContent?.trim() || undefined;
    const image = body.querySelector<HTMLImageElement>('#landingImage, #imgBlkFront');
    const media = Array.from(body.querySelectorAll<HTMLImageElement>('#altImages img, #imageBlock img'))
      .map(img => ({ kind: 'image' as const, url: img.dataset.oldHires || img.src, alt: img.alt || undefined }))
      .filter(item => item.url);
    const features = Array.from(body.querySelectorAll('#feature-bullets li span.a-list-item')).map(el => el.textContent?.trim()).filter(Boolean);
    const attributes = Object.fromEntries(Array.from(body.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr'))
      .map(row => [row.querySelector('th')?.textContent?.trim(), row.querySelector('td')?.textContent?.trim()]).filter(([k, v]) => k && v) as [string, string][]);
    const variants = Array.from(body.querySelectorAll<HTMLElement>('[data-asin][data-defaultasin], #twister li[data-asin]')).map(el => ({
      asin: el.dataset.asin || undefined,
      label: el.getAttribute('title')?.replace(/^Click to select /, '') || el.textContent?.trim() || undefined,
      selected: el.getAttribute('aria-checked') === 'true' || el.classList.contains('swatchSelect'),
    })).filter(v => v.asin);
    return {
      asin: (body.querySelector<HTMLInputElement>('#ASIN')?.value || body.getAttribute('data-asin') || undefined),
      title: text('#productTitle'), byline: text('#bylineInfo'),
      priceText: text('#corePrice_feature_div .a-offscreen, #priceblock_ourprice, #price_inside_buybox'),
      ratingText: text('#acrPopover .a-icon-alt'), reviewCountText: text('#acrCustomerReviewText'),
      availability: text('#availability'), features, attributes, variants,
      media: image?.src ? [{ kind: 'image' as const, url: image.dataset.oldHires || image.src, alt: image.alt || undefined }, ...media] : media,
    };
  });
  return {
    asin: asinFrom(raw.asin), title: raw.title, url: page.url(), byline: raw.byline,
    price: money(raw.priceText), rating: rating(raw.ratingText), reviewCount: integer(raw.reviewCountText),
    availability: raw.availability, features: raw.features, attributes: raw.attributes, variants: raw.variants,
    media: dedupeMedia(raw.media),
  };
}

export async function extractMedia(page: Page) {
  const product = await extractProduct(page);
  const documents = await page.locator('#productDocuments a[href], #manualsAndGuides a[href]').evaluateAll(links => links.map(link => ({
    kind: 'document' as const,
    url: (link as HTMLAnchorElement).href,
    alt: link.textContent?.trim() || undefined,
  })));
  return { asin: product.asin, media: dedupeMedia([...product.media, ...documents]) };
}

export async function extractCategory(page: Page) {
  const breadcrumbs = (await page.locator('#wayfinding-breadcrumbs_container a, .a-breadcrumb a').allTextContents()).map(v => v.trim()).filter(Boolean);
  const children = await page.locator('#departments a[href], #s-refinements a[href]').evaluateAll(links => links.slice(0, 50).map(link => ({
    label: link.textContent?.replace(/\s+/g, ' ').trim(), url: (link as HTMLAnchorElement).href,
  })).filter(item => item.label));
  return { breadcrumbs, children, items: await extractSearch(page) };
}

export async function extractRelated(page: Page) {
  const observedAsin = asinFrom(await page.locator('body').getAttribute('data-asin').catch(() => null));
  const items = await page.locator('[data-a-carousel-options] li, [data-csa-c-content-id*="customers-who"] [data-asin], #sp_detail [data-asin]').evaluateAll(nodes => nodes.map(node => {
    const root = node as HTMLElement;
    const link = root.querySelector<HTMLAnchorElement>('a[href*="/dp/"]');
    return {
      asin: root.dataset.asin || link?.href.match(/\/dp\/([A-Z0-9]{10})/i)?.[1],
      title: root.querySelector('img')?.alt || link?.textContent?.trim(), url: link?.href,
      relation: root.closest('[data-csa-c-content-id*="customers-who"]') ? 'customers_also_viewed' : 'page_carousel',
    };
  }));
  return { asin: observedAsin, items: items.filter(item => item.asin && item.title) };
}

function dedupeMedia<T extends { url: string }>(media: T[]): T[] {
  return [...new Map(media.map(item => [item.url, item])).values()];
}
