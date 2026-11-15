BORDERLESS PATCH 09 | TEST REPOSITORY ADAPTATION | PREVIEW ONLY
Prepared November 15, 2026

REPOSITORY BASELINE:
  ajyanikian/borderless branch shippo-shipping
  user-provided ZIP borderless-shippo-shipping (1).zip
  Current test Worker and D1 bindings must remain unchanged.

THIS ZIP IS NOT FOR THE PRODUCTION REPOSITORY.
DO NOT APPLY THESE FILES TO borderless-checkout-live.
DO NOT REPLACE OR COPY wrangler.jsonc FROM THE PRODUCTION REPOSITORY.
NO SECRETS / DATABASE CREDENTIALS are included in this patch.

FILES IN THIS PACKAGE ARE REPLACEMENTS FOR THE MATCHING PATHS INSIDE
THE TEST REPO (or quantity.js as a new file):
  worker.js
  quantity.js (new)
  checkout-embedded.js
  checkout-shipping.js
  shipping.js
  order-verification.js
  shippo-sync.js
  borderless-site/index.html
  borderless-site/checkout-form-preview.html
  tests/multican.test.mjs (new)

PRESERVED:
- Test worker identity (wrangler.jsonc unchanged)
- Preview D1 database binding (wrangler.jsonc unchanged)
- Test Stripe and Shippo credentials only (sk_test_, shippo_test_)
- Existing Stripe preview SDK page; pk_test publishable key already in source
- Test webhook and D1 schema, manual capture behavior
- Older test checkout-preview.html and thank-you.html

CODE CHANGE:
- Test store quantity selector: 1,2,4,...,20
- Store checkout link accessible only on ?test_checkout=1
- Checkout page stays /checkout-form-preview.html?quantity=N
- Test POST /api/checkout-form-session validates quantity and returns it
- Test Stripe session line item quantity + metadata
- Server-side Shippo shipping based on real parcel plan
- Server-side Stripe order verification and Shippo order quantity/weight
- Retires legacy /api/checkout route from TEST Worker

PACKAGING:
1 can: 8x6x4in, 600g packed (one box)
2 cans: 8x6x4in, 1100g packed (one box)
4+ even: multiple 1100g boxes, two cans per box
20-can temporary maximum, not an inventory rule.

LOCAL OFFLINE TEST:
  node --experimental-default-type=module --test tests/multican.test.mjs

NEXT ACTIONS (AFTER REVIEW):
1. Create a dedicated new branch from test repo shippo-shipping, e.g. multican-test-09.
2. Copy these files into that branch only; keep wrangler.jsonc untouched.
3. Run tests; verify Cloudflare preview deploy maps to test Worker / test D1.
4. Test test-mode checkout session and shipping addresses for 1,2,4,6,10.
   No live credit card or production checkout enabling.
5. Confirm >2 box label workflow and Shippo carrier behavior before live deployment.

NOT VERIFIED:
- Live Shippo multi-piece quotes for actual destinations
- Shopify/Cloudflare custom domain routing
- Customer receipts and business notifications
- Sales tax and sales geography
- Production Worker active commit SHA; dashboard success is user-reported

REVIEW WARNING:
The existing test worker exposes /api/shippo-check and /api/shippo-rate-test
for development; these are NOT to be copied into production.
