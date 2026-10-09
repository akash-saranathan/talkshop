# Brand assets

Put the approved Chase logo here as **`chase-logo.svg`** (from your brand team).

- A PNG works too: name it `chase-logo.png` and start the frontend with `VITE_BRAND_LOGO=/brand/chase-logo.png`.
- Until a file exists, the header shows a text wordmark ("CHASE Marketplace").
- On dark backgrounds (sign-in page) the logo is shown in white automatically.

Switch brands with `VITE_BRAND=chase` (default) or `VITE_BRAND=shopsphere` for the frontend, and
`BRAND=chase` / `BRAND=shopsphere` for the backend (Talkshop messages, API text, emails).
