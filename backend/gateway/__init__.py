"""
Mock payment gateway / PSP + SIMULATED card networks + SIMULATED Chase issuer
(Part 2, Phase 16).

  ShopSphere payment service ──HTTP──► mock gateway (app.py, port 8100)
        ──► simulated Visa network (VIC credential) / simulated card network (card on file)
        ──► simulated Chase issuer ──► authorization response

The merchant never talks to a card network directly: like a real merchant it
goes through a gateway (PSP/acquirer). Nothing here is VisaNet, a real
network or a real issuer. The gateway runs as its own local HTTP service when
MOCK_GATEWAY_URL is set; otherwise the same app is called in-process through
the same HTTP client (tests, or a single-process demo).
"""
