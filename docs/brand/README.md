# BidMorrow brand kit (checkout, invoices, email)

Source of truth for the mark is `apps/web/src/components/Logo.tsx`; the
wordmark is the word "BidMorrow" in Archivo 700 (self-hosted,
`apps/web/public/fonts`). The PNGs here are rendered from those sources at
2× (script kept in the ledger entry of 2026-08-30) — regenerate rather than
edit by hand if the mark ever changes.

| File                                  | Size      | Use                                                                                                      |
| ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `bidmorrow-logo-horizontal-light.png` | 1050×304  | Paddle checkout logo (light theme — the overlay opens `theme: 'light'`), invoices, email header fallback |
| `bidmorrow-logo-horizontal-dark.png`  | 1050×304  | Dark surfaces (social, decks)                                                                            |
| `bidmorrow-mark-512.png`              | 1024×1024 | Square avatar / app icon / Paddle "brand icon" where a square is required                                |

## Colours

| Token                                           | Hex                 | Where                                                                                     |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Accent (dark UI)                                | `#2ec4b0`           | app dark theme buttons                                                                    |
| **Accent on white (checkout, invoices, email)** | **`#0f7d6f`**       | Paddle "primary colour" — AA contrast with white text; matches the light-theme `--accent` |
| Accent gradient                                 | `#35d3c0 → #1fa899` | the mark only                                                                             |
| Ink                                             | `#0b1f1c`           | headings on white                                                                         |
| Muted                                           | `#5b6b68`           | secondary text on white                                                                   |
| Border                                          | `#e3e9e8`           | dividers on white                                                                         |
| Deep canvas                                     | `#12151b`           | mark background                                                                           |

## Paddle — what is set where (verified against the dashboard 2026-08-30)

The overlay has NO seller-logo slot. It shows the **product image** beside
each line item and uses ONE brand colour. So:

- **Product image (API, DONE both accounts)**: `products.update(id,
{ image_url })` → live `https://bidmorrow.com/brand-mark-512.png`,
  sandbox `https://staging.bidmorrow.com/brand-mark-512.png` (the PNGs are
  committed under `apps/web/public/`). Re-run if the mark changes.
- **Brand colour (dashboard)**: Checkout → Checkout settings → **Overlay**
  tab → Brand Color `#0f7d6f` → Save. Do it in live AND sandbox.
- **General tab** (already correct on both): default payment link,
  "Display discount field on the checkout" on, statement descriptor
  `BIDMORROW`, marketing opt-in text mentions BidMorrow.
- **Inline / Recovery tabs**: not used (overlay only) — leave defaults.
- **Invoice PDF**: Paddle issues it as Merchant of Record with Paddle's
  own letterhead plus the product name/price; there is no seller logo on
  the PDF. Customer-facing branding lives in our Settings → Billing area
  and the transactional emails instead.
