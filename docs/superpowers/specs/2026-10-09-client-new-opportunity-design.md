# New opportunity from a client page

Philip, 9 Oct 2026: "I also want to be able to create an opportunity when I am in clients, could be manual or
it could be from a list."

## What it does
- **+ Opportunity** in the client page header (and **+ New opportunity** on its Opportunities tab) opens a form
  on the Opportunities tab.
- **What**: pick from the product catalogue (`opportunity_products`, grouped by family, client price shown), or
  "Something else" and type a name. Products the client already has open in the pipeline are marked and warned.
- **Users / seats / devices / sites** appears for products priced per unit; £ a month fills from client price ×
  quantity (else the product's default value), and can be typed over. £ one-off, Stage (Idea or Proposed),
  Next step. A line shows what will be added before saving.
- Saved to `opportunities` (owner = signed-in person), shown on the client page at once, and the Opportunities
  section reloads if it has been opened. Draft email, won/lost and the rest stay in Opportunities › Pipeline.

## Rules
`newOpportunity()` in `src/core/opportunities.js` (tests in `tests/opportunities.mjs`): a name is required (the
product name if none typed), new ones start Idea or Proposed only, amounts are never negative, a typed
£/month beats the worked-out one. No schema change.
