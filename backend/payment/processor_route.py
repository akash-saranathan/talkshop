"""
Which processor PayIt hands an approved request to, AFTER its 12 checks pass.

Default: the original mock processor (Demo 2 and older callers — unchanged).
ShopSphere's payment service (Demo 1, Part 2) sets a route for one payment so
PayIt's charge step goes through the PaymentGatewayAdapter instead (VIC-inspired
controls + credential, or the standard card-on-file path). A ContextVar keeps
the route scoped to that one request.
"""
from contextvars import ContextVar
from typing import Awaitable, Callable, Optional

from backend.models.payment import PaymentRequest, PaymentResult

Processor = Callable[[PaymentRequest], Awaitable[PaymentResult]]
ACTIVE: ContextVar[Optional[Processor]] = ContextVar("payment_processor_route", default=None)

