# Project context (handoff)

Read this before changing anything. Last updated on branch `devin/1792319361-consolidate-a` (PR #2).

Latest iteration (2026-10-20): the company is **Rta Systems**. Candidate A now includes camera-anchored explanatory arrows for Perception / Belief / Risk, and four applications under one persistent **Fieldcore OS · In development** heading. Under-canopy reconnaissance comes first: a quadrotor launches from a UGV, scouts a corridor, marks it low risk, and hands the route back before the UGV advances. See the current application details in `README.md`.

## What this is
A one-page marketing site for an early-stage defense-autonomy startup. Motto: **"Deterrence through autonomy."**
The company builds foundational autonomy for machines in difficult, uncertain, contested, unmapped, adversarial environments.
Never position it as only a UGV, drone, hardware, swarm or generic-AI company.

**Product names**
- **Fieldcore OS:** the autonomy that runs on each machine, whatever the body (ground, air, legged, maritime). It replaces the earlier name "Autonomy Engine".
- **Shunya OS:** the mission intelligence layer above Fieldcore. It covers orchestration of heterogeneous swarms, AI-assisted mission planning and fleet management. It replaces the earlier name "Orchestration OS".

**Disclosure rule (from the founder):** keep the tech story at "risk- and uncertainty-aware autonomy".
- Describe risk only by its sources: terrain, ambiguous sensing, electronic warfare (EW), and the unknown.
- Do not expose internals in copy: no slope / obstacle / negative-obstacle terms, no pipeline steps, no "2.5D elevation".
- Exception: the founder asked for a negative obstacle (a drop) to be shown *visually* in the ground demo.

## Repo / status
- Repo: https://github.com/shravankumargulvadi/company_website.
- PR #1 is merged; it created the original exploration with candidates A, B and C.
- PR #2 (https://github.com/shravankumargulvadi/company_website/pull/2) is open, on branch `devin/1792319361-consolidate-a`. It holds all the consolidation work below. Do not merge unless asked.
- Candidate **A** is the site and is served at `/` (`src/pages/index.astro`). The candidate index, switcher and Candidates B and C have been removed; `/candidate-a` and `/candidate-c` redirect to `/` (`astro.config.mjs`).
- C's bird's-eye zoom lives on inside the page as `src/components/candidate-a/forceScene.ts`.

## Stack
- Astro 5 (static), TypeScript strict, plain CSS, GSAP + ScrollTrigger, vanilla Three.js (lazy-loaded), Canvas 2D.
- Node via nvm: **run `source ~/.nvm/nvm.sh` before any npm/node command.**
- Commands: `npm run dev` (port 4321), `npm run check`, `npm run build`. Both check and build must pass before pushing.
- If the browser shows 504 "Outdated Optimize Dep", restart the dev server with `npx astro dev --port 4321 --host --force`.
- Don't `pkill -f "astro dev"` in the same shell command as other work: it kills that shell too.

## Page order of / (`src/pages/index.astro`)
All of A is scroll-driven. Scroll keyframes (`KEYS`) are interpolated into a `SceneState` that feeds `src/components/candidate-a/sceneA.ts`.

1. **Hero:** "Deterrence through autonomy." A cursor lens shows the machine's view of the terrain.
2. **01 The shift**, then **02 A different world** (structured vs contested).
3. **Reason** (sticky rail): Reality → Perception → Belief → Risk → Decision, all on one 3D terrain with a UGV.
   - Plain-language callouts point to sensor returns, mapped understanding and raised risk peaks; there is no robot callout. They hide immediately on scroll/resize, then reappear after a 450 ms pause once scene interpolation settles. One terrain feature stays selected until movement resumes; its anchor is projected from the live camera.
   - At *Risk* the terrain lifts into a cost field (`field` state). Height is the combined risk; colour shows the source.
   - Colours: terrain amber, ambiguous sensing violet, EW red. The legend sits in the rail.
   - The fields come from `createWorld({hazards:true})`, which adds `ambiguity` and threat, and they also feed `riskAt`, so the planned path is real.
4. **03 Connected:** the UGV arrives at `A_GOAL` and stops. A comms arc rises towards `A_HUB`, and the camera turns straight top-down (`bev`).
   - The UGV's progress (`drive`) is tied **linearly to scroll** from the top of the page, so it never rushes. The founder disliked the earlier fast catch-up.
5. **04–07 bird's-eye force chapter:** a fixed Canvas 2D `ForceScene` (`src/components/candidate-a/forceScene.ts`, originally Candidate C) runs on A's world.
   - It cross-fades in at the same spot and scale. Start zoom is `z0 = 2·dist·tan(fov/2)/EXTENT`; shared constants are in `worldA.ts`.
   - While `move < 0.01`, the 2D hero is snapped to the 3D UGV via `setHero`.
   - At the handoff, the `engine` ring (copied from Candidate C at the founder's request) orbits the UGV, cycling Perceive → Believe → Assess risk → Plan → Act. `engine` is 1 at the first force stage and fades to 0 by Shunya OS; it also rings the other machines while they share the loop.
   - Captions:
     - 04 Fieldcore OS (one autonomy, many bodies)
     - 05 Autonomous teams
     - 06 Human–machine teaming
     - 07 Shunya OS (mission intelligence layer)
   - The HUD shows machine/operator/team counts and a scale bar.
6. **08 Why it matters:** the deterrence framing. Three steps light up in turn:
   1. Autonomous capabilities at scale.
   2. Defensive and offensive superiority.
   3. Deterrence through denial and punishment.

   The fixed bird's-eye canvas stays behind it, heavily dimmed.
7. **09 Fieldcore OS applications:** a persistent product heading states **Fieldcore OS · In development**. It is the platform under development; the tabs illustrate applications. Scrolling automatically advances through **Under-canopy → Fixed-wing → Underground → Pilot assistance**. Each application has its own full scroll range; tabs jump to its start and support keyboard navigation. Mobile uses two rows. No-WebGL mode keeps under-canopy, underground and pilot assistance through Canvas fallbacks.
   - **Under-canopy** (`forestScene.ts`, `forestRecon.ts`, `forestMap2d.ts`): a quadrotor lifts from a UGV launch deck, checks hazards and scouts the eastern corridor. The route turns green and is labelled low risk before the UGV starts. A short camera handoff follows the vehicle, while the map retains the scout, UGV and team. Unobserved forest stays unknown.
   - **Pilot assistance** (`landingScene.ts`, `landing.ts`, `landingMap2d.ts`): a gear-mounted camera views uneven terrain through dusk and fog. A parallel map shows 64–128 weighted approach samples and their mean. The pilot remains in command; the sequence is illustrative, not a flight controller.
   - **Air** (`airScene.ts`, own canvas `#a-air`, created lazily):
     - A fixed-wing aircraft flies low through a procedural canyon, with a chase camera on the left and a risk map on the right.
     - A radar dome (EW) appears over its planned branch. The planned route turns red and gets struck through, and the aircraft re-plans into the other canyon ("terrain-masked").
   - **Ground** (`deepScene.ts` + `src/lib/passage.ts`; fallback in `passageMap2d.ts`):
     - A chase camera keeps the rover in view in a dark passage. The right side is an instanced-box risk map, with hatched cells for ground not yet observed.
     - Route: the rover drives to a fork, goes ~3 m down the short direct branch, and sees a drop. Drop cells only register within 2.2 m and show red; the drop edge is marked in the camera view.
     - It reverses back to the fork and takes the 38 m low-risk detour. Labels read "Direct · 14 m · drop · high risk" and "Detour · 38 m · low risk · chosen".
     - Scroll mapping is in the page script (`target()` / `viewAt()`).
8. **Closing CTA.** The "In development" proof section was removed on purpose; it may come back later.

## Design history / founder preferences
- The founder gives detailed briefs and expects clean, faithful implementation. Ask when a request is ambiguous; for example, his words once pointed at one section while his screenshot showed another.
- When given a visual reference, match it closely rather than reinterpreting it. But taste can swing back: he once rolled the underground map back to its first blocky orange version. Keep each visual iteration in its own commit so it can be reverted.
- The reference video `reference_material/sample_cave_passage.mp4` is inspiration only. Never embed or ship it.
- Copy: short and concrete. Avoid "AI-powered", "next generation", "revolutionary" and similar.
- Every animation must communicate an idea.

## Known rough edges / open items
- Ground demo: at the start, the map is framed partly off the right edge. The drop is hard to see in the dark (the red edge line does the work).
- Air demo: the "planned" and "re-plan" labels can overlap. The aircraft and canyon are simple placeholders.
- 3D → 2D cross-fade: the 3D UGV model is much larger than the 2D icon. The comms line alignment is approximate.
- The deterrence section's backdrop is very dark.
- Mobile was checked only partly, at 390×844 earlier. The tabs and deterrence section are unchecked on mobile.
- The no-WebGL fallback has not been re-checked; the Air tab is hidden there. Real-GPU performance is unmeasured; everything was tested with software WebGL.
- Contact form: Web3Forms key `contactFormKey` in `src/config/site.ts` forwards to the founder’s inbox (the form shows a not-available message if it is empty). Placeholders: procedural terrain, line-art glyphs. The company name is Rta Systems.
- Current environment has no browser connected to the computer-use tool; visual screenshots cannot be claimed from the current run. Model, geometry, build and TypeScript checks are available. The documented `~/.nvm/nvm.sh` is also absent here; use installed Node when that startup file is unavailable.

## Verification tips
- Screenshots via Playwright over CDP (`http://localhost:29229`): scroll to `section top + progress × (offsetHeight − innerHeight)` for a `[data-sec]`, wait about 2.5 s, then screenshot.
- Ignore software WebGL warnings (ReadPixels / swiftshader) in the console.
