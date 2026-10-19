# Agent guidelines

**First, read `docs/CONTEXT.md`.** It holds the project background, product naming, disclosure rules, page structure, design history and open issues.

## Working rules
- Run `source ~/.nvm/nvm.sh` before any node/npm command.
- After every code change, run `npm run check` and `npm run build`. Both must pass.
- Visually verify scroll-driven changes. Take screenshots at several scroll positions, desktop first, then mobile. Report rough edges honestly.
- Work on a branch and open or update a PR. Never push to or merge `main` unless asked.
- Make focused edits that follow the existing conventions: vanilla Three.js / Canvas 2D, lazy loading, the `whenNear` / `visibleLoop` helpers in `src/lib/motion.ts`, and real HTML text rather than text baked into canvases.
- Keep heavy visuals lazy-loaded. Keep the no-WebGL and reduced-motion paths working.
- Respect the disclosure rule: describe risk only by its sources (terrain, ambiguous sensing, EW, unknown), never the internals.
- Use the product names exactly: **Fieldcore OS** (per-machine autonomy) and **Shunya OS** (mission intelligence layer).
- Copy should be concise and concrete, with no buzzwords. Every animation should communicate an idea.
- Never embed or ship `reference_material/` media.
- Ask the founder when a request is ambiguous. Keep each visual iteration in its own commit so it can be reverted.
