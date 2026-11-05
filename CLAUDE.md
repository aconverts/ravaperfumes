# RAVA Perfumes theme (Prestige)

## Branches
- `main` is the PUBLISHED live theme. Any push or merge to main goes live instantly.
- `dev` is the draft theme. Work here by default.
- Live edits from the Shopify customizer and code editor commit to main automatically.

## Before every task
- Run: `git checkout dev && git pull origin main && git pull origin dev`
- Dev must absorb live edits from main before any work starts.

## Rules
- Never push or merge to `main` unless I explicitly say "publish to main" or "merge to main".
- Never force-push to `main`.
- Never edit `config/settings_data.json` unless explicitly asked.
- When merging dev into main, never overwrite main's `config/settings_data.json` or `templates/*.json` with dev's versions unless the task explicitly changed them. They hold live customizer content.
- Don't rename or delete existing sections, snippets or templates. Live pages depend on them.
- Prefer adding new sections/snippets over editing core Prestige files.
- One feature or fix per commit, with a clear message.
- No em dashes in any customer-facing copy.

## Publishing
When asked to publish:
1. Pull both branches.
2. Show me a summary of what will go live (files and what changed).
3. Wait for my confirmation.
4. Open a PR from dev to main with `gh pr create`, then merge it with `gh pr merge`.

## Context
- Store: ravaperfumes.com (7j9d1e-b2.myshopify.com), Lebanon, high traffic.
- Live theme carries the Black Friday Offer (Buy 1 Get 2). Don't break the offer logic or messaging.
