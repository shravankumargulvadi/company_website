# Project context (handoff)

Read this before changing anything. Last updated on branch `devin/1792319361-consolidate-a` (PR #2).

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
- Candidate **A** (`/candidate-a`) is the primary site.
- Candidate **B** has been deleted.
- Candidate **C** (`/candidate-c`) is kept only as a reference; its bird's-eye zoom now lives inside A. Remove C when the founder says.
- `/` is an internal index. The review switcher pill was removed (`switcher` defaults to false in `src/layouts/Base.astro`).

## Stack
- Astro 5 (static), TypeScript strict, plain CSS, GSAP + ScrollTrigger, vanilla Three.js (lazy-loaded), Canvas 2D.
- Node via nvm: **run `source ~/.nvm/nvm.sh` before any npm/node command.**
- Commands: `npm run dev` (port 4321), `npm run check`, `npm run build`. Both check and build must pass before pushing.
- If the browser shows 504 "Outdated Optimize Dep", restart the dev server with `npx astro dev --port 4321 --host --force`.
- Don't `pkill -f "astro dev"` in the same shell command as other work: it kills that shell too.

## Page order of /candidate-a (`src/pages/candidate-a.astro`)
All of A is scroll-driven. Scroll keyframes (`KEYS`) are interpolated into a `SceneState` that feeds `src/components/candidate-a/sceneA.ts`.

1. **Hero:** "Deterrence through autonomy." A cursor lens shows the machine's view of the terrain.
2. **01 The shift**, then **02 A different world** (structured vs contested).
3. **Reason** (sticky rail): Reality → Perception → Belief → Risk → Decision, all on one 3D terrain with a UGV.
   - At *Risk* the terrain lifts into a cost field (`field` state). Height is the combined risk; colour shows the source.
   - Colours: terrain amber, ambiguous sensing violet, EW red. The legend sits in the rail.
   - The fields come from `createWorld({hazards:true})`, which adds `ambiguity` and threat, and they also feed `riskAt`, so the planned path is real.
4. **03 Connected:** the UGV arrives at `A_GOAL` and stops. A comms arc rises towards `A_HUB`, and the camera turns straight top-down (`bev`).
   - The UGV's progress (`drive`) is tied **linearly to scroll** from the top of the page, so it never rushes. The founder disliked the earlier fast catch-up.
5. **04–07 bird's-eye force chapter:** a fixed Canvas 2D `ForceScene` (from `src/components/candidate-c/sceneC.ts`) runs on A's world.
   - It cross-fades in at the same spot and scale. Start zoom is `z0 = 2·dist·tan(fov/2)/EXTENT`; shared constants are in `worldA.ts`.
   - While `move < 0.01`, the 2D hero is snapped to the 3D UGV via `setHero`.
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
7. **09 Fieldcore OS (In progress):** a split screen with two demos, picked with a prominent top-centre switch. **Air is the default.** Clicking a tab scrolls to the start of the section, so the demo restarts.
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
- Placeholders: company name/email in `src/config/site.ts`, procedural terrain, line-art glyphs.

## Verification tips
- Screenshots via Playwright over CDP (`http://localhost:29229`): scroll to `section top + progress × (offsetHeight − innerHeight)` for a `[data-sec]`, wait about 2.5 s, then screenshot.
- Ignore software WebGL warnings (ReadPixels / swiftshader) in the console.
