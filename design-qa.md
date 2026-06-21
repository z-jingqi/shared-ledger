# Design QA — 一起记账本首页

**Source visual truth:** `D:\shared-ledger\accounting-app-mobile-design\screens\02-books\03-book-home.png`  
**Implementation screenshot:** `D:\shared-ledger\artifacts\home-mobile-qa.png`  
**Viewport / state:** 430 × 932 mobile, `/books/book_home`, free-user home state; desktop was also inspected at 1280 × 800.

## Evidence

The mobile comparison uses the reference image above and the captured implementation screenshot. Both display the same home-state hierarchy: book name, monthly three-column summary, pending-record CTA, recent transactions, orange record CTA, and fixed navigation. Focused inspection covered the summary block, transaction icon rows, and bottom navigation. Desktop inspection confirmed a centered phone-width surface without clipping or navigation overlap.

## Findings

No actionable P0, P1, or P2 findings remain.

- Fonts and typography: Chinese-system fallback hierarchy is consistent with the source's bold display heading, strong monetary values, and restrained metadata. The exact exported design font is not bundled; the system fallback is an acceptable platform-safe match.
- Spacing and layout rhythm: 18px mobile side gutters, generous section gaps, rounded single-layer panels, and a bottom safe area preserve the reference's light, flat rhythm. Desktop intentionally centers the same mobile-width canvas as required by the brief.
- Colors and tokens: `apps/web/src/styles.css` imports the supplied Tailwind v4/OKLCH token source. The primary orange, near-white panels, muted slate metadata, light borders, and low-elevation shadows match the source intent.
- Image quality and asset fidelity: this UI state contains no product photography or decorative raster assets. Transaction/category marks use the Phosphor icon library; no emoji, handcrafted SVG, CSS art, or placeholder illustration remains.
- Copy and content: Chinese labels match the product terminology and the supplied screen semantics. The five-item navigation is an intentional implementation of the explicit product navigation requirement, even though the specific source home frame presents a reduced navigation set.
- Accessibility and responsiveness: controls use native links/buttons/inputs, form labels are present, active color contrast is preserved, and the phone canvas remains intact at the inspected desktop width.

## Patches made since the comparison

- Replaced transaction and pending-record emoji with consistent Phosphor icons in `apps/web/src/App.tsx`.
- Re-captured the mobile home state after the icon correction.

## Implementation checklist

- [x] Mobile-first frame and desktop-centered layout
- [x] Supplied token stylesheet applied
- [x] Core hierarchy and account-home interactions rendered
- [x] Native icon family used for visible symbols
- [x] Mobile and desktop visual inspection completed

## Follow-up polish

- [P3] When the product selects a licensed Chinese webfont, add it as an optional font-face to tighten the final match to the exported mock.
- [P3] Add image snapshots for the remaining reference routes as their API data moves from demonstration fixtures to live D1 data.

final result: passed
