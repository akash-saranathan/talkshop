"""
VisaIntelligentCommerceSimulator (Part 2) — a LOCAL, Visa Intelligent
Commerce-INSPIRED simulator for Demo 1.

It mirrors the published VIC lifecycle conceptually:
  agent-specific token enrollment → cardholder authentication (passkey)
  → authenticated payment instruction → controls → purchase-specific
  credential → merchant acceptance (via a gateway) → commerce signals.

It is NOT connected to Visa, does not use the Visa Token Service, VisaNet or
any Visa API, and is not VIC compliant or certified. Every token, credential
and passkey here is a random demo value created on this machine.

Modules:
  common        ids, clock, errors, lifecycle state machine
  passkey       simulated passkey / step-up challenges
  enrollment    AgentTokenEnrollmentService
  instructions  PaymentInstructionService
  credentials   VIC controls + PaymentCredentialService
  signals       CommerceSignalsService
"""
