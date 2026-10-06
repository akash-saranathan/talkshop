"""
Talkshop — ShopSphere's built-in shopping assistant (Demo 1, Phase 3).

The LLM understands the shopper and chooses what should happen next; the
ShopSphere services in backend/shop/ do it. A stage machine (state.py)
limits what can happen at each point, and the only way into payment is the
shopper's own GO AHEAD action — never anything the LLM produces.
"""
