# Company website — exploration prototypes

One-page website prototypes for the company thesis **"Deterrence through autonomy."** **Candidate A is the primary direction** and now absorbs Candidate C's bird's-eye force chapter. Candidate B has been dropped. Candidate C stays up as a reference while its pieces move into A.

| Route | Candidate | One-line idea |
| --- | --- | --- |
| `/candidate-a` | **The Machine's Eyes** | See the world the way the machine does: reality → perception → belief → risk → decision |
| `/candidate-c` | **From One Machine to a Force** | One continuous zoom-out, from a single machine to a distributed, human-supervised force |

`/` is an internal index that links the candidates. A small pill in the bottom-left corner of every page switches between candidates; it is for review only.

## Running

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # static output in dist/
npm run check     # astro + TypeScript diagnostics
```

Requires Node 18.17+ (developed on Node 24).

## Stack

- **Astro 5** with static output and no UI framework, plus **TypeScript** in strict mode.
- **GSAP + ScrollTrigger** for scroll choreography.
- **Three.js**, used only by Candidate A and lazy-loaded with custom shaders.
- **Canvas 2D** for the bird's-eye force view (Candidate A chapter 04–07, Candidate C) and the no-WebGL fallbacks.
- Self-hosted fonts via Fontsource: Instrument Serif (A), Inter Tight (C), IBM Plex Mono (shared).

### Shared simulation layer (`src/lib/`)

Both candidates draw from the same small, deterministic model of an autonomy problem, so the visuals stay technically honest and are not just decoration:

- `noise.ts`: seeded simplex noise and fBm.
- `world.ts`: procedural terrain (height, slope, water, threat envelopes); **embodiment-specific risk profiles** (`PROFILES` for ground, air, legged, maritime); a `KnowledgeMap` of what has been observed, which decays over time; a constant-curvature **arc planner** scored on risk plus progress (`planArcs`); and receding-horizon `rollout`. Unknown space is always *priced as risk*, never treated as free space. This is the thesis expressed in code.
- `glyphs.ts`: placeholder line-art glyphs for each embodiment (side and plan views).
- `simView.ts`: Canvas renderer for the proof reel (plan, risk and belief views).
- `motion.ts`: GSAP setup, WebGL detection, reduced-motion handling, and visibility-gated render loops.

Copy, contact details and proof media are kept in `src/config/` so they can be changed without touching layout code.

---

## Candidate A — The Machine's Eyes

**Files:** `src/pages/candidate-a.astro`, `src/components/candidate-a/` (`sceneA.ts`, `deepScene.ts`, `worldA.ts`)

- **Storytelling concept:** the visitor alternates between the physical world and the machine's internal understanding of it, then zooms out from one machine to a force.
- **Disclosure level:** the page shows risk- and uncertainty-aware autonomy at a high level only. Risk is described by its sources (terrain, ambiguous sensing, electronic warfare, the unknown), not by the internal risk terms or pipeline.
- **Page order:**
  1. Hero, the shift, a different world.
  2. **Reality → Perception → Belief → Risk → Decision** on one 3D terrain with a ground vehicle. At *Risk* the terrain lifts into a cost field: height is the combined risk, colour the source (terrain amber, ambiguous sensing violet, electronic warfare red). These fields also feed `riskAt`, so the planned path really avoids them.
  3. **03 Connected:** the vehicle drives to its objective and stops, a comms link arcs from it towards the Shunya OS node, and the camera rises to straight top-down.
  4. **04–07, bird's-eye force chapter:** once the 3D camera is top-down, a fixed Canvas 2D layer (Candidate C's `ForceScene`, run on A's world with the vehicle at the same spot and scale) cross-fades in and keeps zooming out: **Fieldcore OS** (the autonomy on every machine, many bodies), autonomous teams, human–machine teaming, and **Shunya OS**, the mission intelligence layer above it (swarm orchestration, AI-assisted mission planning, fleet management).
  5. **08 Fieldcore OS:** two tabs, see below.
  6. In development (proof reel), closing CTA.
- **Implementation:** vanilla Three.js with one terrain mesh and a custom shader driven by scroll keyframes (`KEYS` → `SceneState`, including `comm` and `bev` for the handoff; the lead vehicle's progress `drive` is tied linearly to scroll so it arrives at the goal smoothly). `worldA.ts` holds the shared world options, goal and Shunya OS node so the 3D and 2D views line up. If WebGL is unavailable, a Canvas 2D fallback is used.
- **Placeholder vs production-ready:** procedural terrain, line-art machines and proof renders are placeholders; the scroll/scene architecture, handoff and fallbacks are close to production. Tune on real GPUs and do a mobile art-direction pass before launch.

### Candidate A — Fieldcore OS chapter (Ground / Air tabs)

Inspired by the reference risk-estimation capture in `reference_material/` (it is **not** embedded or shipped).

- **Ground tab:** no GPS, no light, no map. A chase camera follows the rover to a fork. It starts down the short direct branch, sees a drop (only visible up close), reverses out and takes the long, low-risk detour.
- **Air tab:** `src/components/candidate-a/airScene.ts`. A fixed-wing machine flies low through a canyon, detects a radar (electronic warfare risk) covering its planned branch, and re-plans into the other canyon, keeping terrain between itself and the emitter.
- **Interaction:** a pinned split screen. Scrolling drives the machine to the fork, holds while the camera looks down the direct branch and both routes are drawn on the map with their lengths, then drives the detour. Left: headlit camera view. Right: risk map built from what it has seen; unobserved space stays hatched.
- **Implementation:** `src/lib/passage.ts` is a deterministic passage model (entry tunnel, fork, a direct branch with a drop and rubble, a winding detour, goal chamber, range sensor with occlusion, per-cell first/best observation). `deepScene.ts` draws both viewports from one WebGL context. `passageMap2d.ts` is the Canvas fallback and the "confined passage" proof placeholder.

## Candidate C — From One Machine to a Force

**Files:** `src/pages/candidate-c.astro`, `src/components/candidate-c/sceneC.ts`

- **Storytelling concept:** a single continuous zoom-out that communicates the largest strategic ambition. Its intended reaction is *"This starts as autonomy software but can become infrastructure for autonomous warfare."*
- **Visual metaphor:** a map that keeps getting bigger, read through a live scale bar (500 m → 5 km) and counters for machines, operators and teams.
- **Major interaction:** one pinned, full-bleed canvas with nine stages and **one unbroken camera move**. It opens on one machine close up. Next come the contested world (threat envelopes, jamming, no GNSS, the unobserved fog of war), then uncertainty reasoning (live risk field and candidate arcs), then the Autonomy Engine loop orbiting the machine. Ground, air, legged and maritime machines appear, then a heterogeneous team that builds one shared belief, then an operator supervising the team. The camera ends on three teams, three operators and the Shunya OS hub, with task and state traffic flowing over a 40 × 40 km area of operations. A rail on the right shows where you are in the zoom.
- **Why it fits the thesis:** it is the only candidate that makes the step from autonomy engine to autonomous teams to force-level orchestration feel continuous and inevitable, and it still starts with the core technical idea of risk under uncertainty.
- **Primary technical implementation:** Canvas 2D. Terrain is rasterised once into a full-map image plus a high-resolution detail patch, asynchronously and in chunks so the main thread is never blocked. Everything else is drawn live each frame: the hero machine runs the real receding-horizon planner against its own knowledge map; other machines follow pre-planned, embodiment-aware rollouts and reveal a shared, decaying belief map. Camera zoom is interpolated in log space between stage keyframes. Rendering pauses when off-screen. A low-power path uses smaller terrain and rasters.
- **Placeholder vs production-ready:**
  - *Placeholder:* procedural terrain, glyphs, team composition and the proof reel.
  - *Close to production:* the stage/camera system, live simulation, HUD and caption system.
  - *Before launch:* do a design pass on the far-zoom network layer, and consider real map tiles or DEM data for the terrain.

---

## Shared placeholders (replace before launch)

- `src/config/site.ts`: company name (`COMPANY`), wordmark and contact email (`contact@example.com`).
- `src/config/proof.ts` and `src/components/shared/ProofReel.astro`: proof items currently render procedural Canvas simulations labelled *"Placeholder — replace with capture"*. Put real MP4/WebM clips in `public/assets/proof/` and set `src` on each item.
- `public/favicon.svg`: temporary mark.
- `src/components/shared/CandidateSwitcher.astro` and `src/pages/index.astro`: review tooling only; remove for production.
- Pages are marked `noindex` in `src/layouts/Base.astro`.

## Performance and accessibility notes

- Heavy visuals load after first paint, and render loops run only while visible (`visibleLoop`).
- No large textures or models: all terrain is procedural, and the total JS for each page is small. Run `npm run build` to see per-page bundles.
- WebGL fallback (A), no-WebGL designs (B and C), and `prefers-reduced-motion` support (continuous animations are disabled and scrubs are snappier).
- Headlines and captions are real HTML text, not baked into canvases.
