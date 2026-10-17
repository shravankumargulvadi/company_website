# Company website — exploration prototypes

Three independent one-page website candidates for the company thesis **"Deterrence through autonomy."** They are exploration prototypes, not a finished site. Each one tests a different narrative and interaction direction so we can choose a production direction later. None of them has been picked as the winner.

| Route | Candidate | One-line idea |
| --- | --- | --- |
| `/candidate-a` | **The Machine's Eyes** | See the world the way the machine does: reality → perception → belief → risk → decision |
| `/candidate-b` | **The Autonomy Machine** | The architecture is the protagonist; the system assembles itself as you scroll |
| `/candidate-c` | **From One Machine to a Force** | One continuous zoom-out, from a single machine to a distributed, human-supervised force |

`/` is an internal index that links the three. A small pill in the bottom-left corner of every page switches between candidates; it is for review only.

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
- **Canvas 2D** (Candidate C) and **SVG** (Candidate B), so each candidate also tests a different rendering approach and performance profile.
- Self-hosted fonts via Fontsource: Instrument Serif (A), Space Grotesk (B), Inter Tight (C), IBM Plex Mono (shared).

### Shared simulation layer (`src/lib/`)

All three candidates draw from the same small, deterministic model of an autonomy problem, so the visuals stay technically honest and are not just decoration:

- `noise.ts`: seeded simplex noise and fBm.
- `world.ts`: procedural terrain (height, slope, water, threat envelopes); **embodiment-specific risk profiles** (`PROFILES` for ground, air, legged, maritime); a `KnowledgeMap` of what has been observed, which decays over time; a constant-curvature **arc planner** scored on risk plus progress (`planArcs`); and receding-horizon `rollout`. Unknown space is always *priced as risk*, never treated as free space. This is the thesis expressed in code.
- `glyphs.ts`: placeholder line-art glyphs for each embodiment (side and plan views).
- `simView.ts`: Canvas renderer for the proof reel (plan, risk and belief views).
- `motion.ts`: GSAP setup, WebGL detection, reduced-motion handling, and visibility-gated render loops.

Copy, contact details and proof media are kept in `src/config/` so they can be changed without touching layout code.

---

## Candidate A — The Machine's Eyes

**Files:** `src/pages/candidate-a.astro`, `src/components/candidate-a/sceneA.ts`

- **Storytelling concept:** the visitor alternates between the physical world and the machine's internal understanding of it. Its intended reaction is *"This company sees autonomy differently."*
- **Visual metaphor:** a lens. The hero is a dark, cinematic terrain. Moving the cursor opens a circular lens that shows the same ground as the machine perceives it.
- **Major interaction:** a pinned, scroll-driven transformation of a single 3D terrain: **Reality → Perception** (lidar-like point cloud) **→ Belief** (contours plus the unknown) **→ Risk** (amber risk field with contours) **→ Decision** (fan of candidate trajectories, one selected and executed). A "structured world" mode (grid, roads, small UGV) sets up the contrast with defense environments. The camera then pulls back: the same scene re-weights risk for ground, air, legged and maritime machines, and finally shows a supervised team with orchestration links.
- **Why it fits the thesis:** the signature moment is risk- and uncertainty-aware autonomy, shown on the terrain itself. The machine is small and the reasoning is large, so the page never reads as a UGV company.
- **Primary technical implementation:** vanilla Three.js loaded on first paint, with one terrain mesh and a custom GLSL shader that blends reality, belief, risk and structured-world modes from uniforms. A `DataTexture` carries the live knowledge map, and points use a separate shader. Scroll keyframes (`KEYS`) are interpolated into a single `SceneState`. Small or low-concurrency devices get a lower-resolution mesh. If WebGL is unavailable, a Canvas 2D fallback renders the proof-style top-down view.
- **Placeholder vs production-ready:**
  - *Placeholder:* procedural terrain instead of real photogrammetry or captured data; line-art machine models; proof-reel renders.
  - *Close to production:* the scroll and scene architecture, the shader pipeline, lens interaction, fallbacks and copy structure.
  - *Before launch:* tune on real GPUs (only tested here on software WebGL), consider a photographic or video hero layer behind the "reality" state, and do a mobile art-direction pass.

## Candidate B — The Autonomy Machine

**Files:** `src/pages/candidate-b.astro`, `src/components/candidate-b/engineModel.ts`

- **Storytelling concept:** the architecture itself is the visual protagonist. Its intended reaction is *"I understand exactly what they're building."*
- **Visual metaphor:** an engineering drawing that comes to life. The hero is the autonomy loop as a living ring. A "structured vs contested" diagram pair explains the problem.
- **Major interaction:** a pinned section that **assembles the Autonomy Engine** step by step. A machine and its sensors appear, then sensor rays and a point scan, then a world-belief grid where hatched cells are unknown and the frontier is marked. Next come the risk field, candidate trajectories with the selected plan, and the machine executing it. Finally a return arc closes the *Perceive → Build belief → Estimate risk → Plan → Act → Adapt* loop along a pipeline rail. The whole diagram then compresses into a single **Autonomy Engine** chip. That chip splits into four, each sitting on an embodiment-specific *platform dynamics · control* layer above ground, air, legged and maritime machines. An **Orchestration OS** bar and *mission intent / human supervision* drop in above them, with live task (↓) and state (↑) pulses.
- **Why it fits the thesis:** it is the clearest explanation of the two product layers and of the shared/specific split: reasoning architecture is shared, while dynamics, controllers and risk weights are per-embodiment. Both are labelled in the diagram.
- **Primary technical implementation:** the diagram is pure SVG generated **at build time** in Astro frontmatter. The belief grid, unknown cells, risk colours, scan points and planner candidates are computed by running the shared `world.ts` planner during the build, so the browser receives static SVG with no runtime simulation cost. One GSAP timeline, pinned and scrubbed, choreographs layers. CSS keyframes drive continuous motion (sensor flow, pulses). This is the lightest page and needs no WebGL.
- **Placeholder vs production-ready:**
  - *Placeholder:* embodiment glyphs, sensor names and the proof reel.
  - *Close to production:* the diagram system, build-time generation, timeline, responsive layout and accessible text (captions are real HTML).
  - *Before launch:* have engineering confirm the module names and sensor list, and replace glyphs with final illustrations.

## Candidate C — From One Machine to a Force

**Files:** `src/pages/candidate-c.astro`, `src/components/candidate-c/sceneC.ts`

- **Storytelling concept:** a single continuous zoom-out that communicates the largest strategic ambition. Its intended reaction is *"This starts as autonomy software but can become infrastructure for autonomous warfare."*
- **Visual metaphor:** a map that keeps getting bigger, read through a live scale bar (500 m → 5 km) and counters for machines, operators and teams.
- **Major interaction:** one pinned, full-bleed canvas with nine stages and **one unbroken camera move**. It opens on one machine close up. Next come the contested world (threat envelopes, jamming, no GNSS, the unobserved fog of war), then uncertainty reasoning (live risk field and candidate arcs), then the Autonomy Engine loop orbiting the machine. Ground, air, legged and maritime machines appear, then a heterogeneous team that builds one shared belief, then an operator supervising the team. The camera ends on three teams, three operators and the Orchestration OS hub, with task and state traffic flowing over a 40 × 40 km area of operations. A rail on the right shows where you are in the zoom.
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
