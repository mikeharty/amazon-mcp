# Optional Keepa provider

This provider is disabled unless an API key is injected. It never reads an environment variable itself, which keeps credential ownership in application configuration. Keepa requires the key as a query parameter, so the provider never logs or returns request URLs and replaces fetch, HTTP, and decoding failures with fixed error codes.

The initial adapter supports Amazon.com (`domain=1`) only:

- Product price history uses `/product`, `history=1`, a bounded `days` value, and `update=-1`. It does not request offers, ratings, Buy Box data, or another paid option. Keepa documents a base cost of one token per found/requested product, with a missing ASIN costing zero when `update=-1`.
- Seller information uses `/seller` with `storefront=0`, costing at most one token per requested seller. It does not request the nine-token storefront option.
- Calls are serialized per provider instance. Batches default to 10 identifiers and can never exceed Keepa's documented 100-item endpoint limit. A response with no remaining tokens blocks another call until its reported refill window.
- Responses are capped at 5 MiB by default and decoded to a small allowlisted shape. No raw provider payload is returned.

Every successful result is marked `partial`. Keepa price history reflects Keepa observations and can contain gaps; seller data can be stale or unavailable. It is enrichment, not authoritative current Amazon account, offer, delivery, or transaction state.

Official references checked 2026-09-22:

- <https://keepa.com/api-docs/request-basics.html>
- <https://keepa.com/api-docs/product.html>
- <https://keepa.com/api-docs/product-object.html>
- <https://keepa.com/api-docs/seller.html>
- <https://keepa.com/api-docs/seller-object.html>
