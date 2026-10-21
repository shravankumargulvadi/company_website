# RTA Systems — website

The company name comes from Sanskrit **Ṛta (ऋत)**, the principle of cosmic order or truth and a Vedic antecedent of dharma. The brand uses **RTA Systems** (also the browser tab title), with **RTA SYSTEMS** as its wordmark.

One-page website for the company thesis **"Deterrence through autonomy."** The site is served at `/` (formerly Candidate A, "The Machine's Eyes"). The exploration candidates B and C have been removed; C's bird's-eye force chapter and its Fieldcore loop ring live on inside the page. The old `/candidate-a` and `/candidate-c` routes redirect to `/` (see `astro.config.mjs`).

Hosted on GitHub Pages at https://shravankumargulvadi.github.io/company_website/. `.github/workflows/deploy.yml` builds and deploys every push to `main`. The site is built under `base: '/company_website'`; set `base` to `'/'` (and `site` to the new URL) when the custom domain is added.

## Running

```bash
npm install
npm run dev       # http://localhost:4321/company_website/
npm run build     # static output in dist/
npm run check     # astro + TypeScript diagnostics
npm test          # reconnaissance, landing assessment and motion checks
```

Requires Node 18.17+ (developed on Node 24).

## Stack

- **Astro 5** with static output and no UI framework, plus **TypeScript** in strict mode.
- **GSAP + ScrollTrigger** for scroll choreography.
- **Three.js**, lazy-loaded with custom shaders.
- **Canvas 2D** for the bird's-eye force view (chapters 04–07) and the no-WebGL fallbacks.
- Self-hosted fonts via Fontsource: Instrument Serif (display), Inter Tight (body), IBM Plex Mono.

### Shared simulation layer (`src/lib/`)

The page draws from the same small, deterministic model of an autonomy problem, so the visuals stay technically honest and are not just decoration:

- `noise.ts`: seeded simplex noise and fBm.
- `world.ts`: procedural terrain (height, slope, water, threat envelopes); **embodiment-specific risk profiles** (`PROFILES` for ground, air, legged, maritime); a `KnowledgeMap` of what has been observed, which decays over time; a constant-curvature **arc planner** scored on risk plus progress (`planArcs`); and receding-horizon `rollout`. Unknown space is always *priced as risk*, never treated as free space. This is the thesis expressed in code.
- `glyphs.ts`: placeholder line-art glyphs for each embodiment (side and plan views).
- `simView.ts`: Canvas renderer for the proof reel (plan, risk and belief views).
- `motion.ts`: GSAP setup, WebGL detection, reduced-motion handling, and visibility-gated render loops.

Copy, contact details and proof media are kept in `src/config/` so they can be changed without touching layout code.

---

## The page — The Machine's Eyes

**Files:** `src/pages/index.astro`, `src/components/candidate-a/` (`sceneA.ts`, `forceScene.ts`, `deepScene.ts`, `worldA.ts`)

- **Storytelling concept:** the visitor alternates between the physical world and the machine's internal understanding of it, then zooms out from one machine to a force.
- **Disclosure level:** the page shows risk- and uncertainty-aware autonomy at a high level only. Risk is described by its sources (terrain, ambiguous sensing, electronic warfare, the unknown), not by the internal risk terms or pipeline.
- **Page order:**
  1. Hero, the shift, a different world.
  2. **Reality → Perception → Belief → Risk → Decision** on one 3D terrain with a ground vehicle. At *Risk* the terrain lifts into a cost field: height is the combined risk, colour the source (terrain amber, ambiguous sensing violet, electronic warfare red). These fields also feed `riskAt`, so the planned path really avoids them.
  3. **03 Connected:** the vehicle drives to its objective and stops, a comms link arcs from it towards the Shunya OS node, and the camera rises to straight top-down.
  4. **04–07, bird's-eye force chapter:** once the 3D camera is top-down, a fixed Canvas 2D layer (`ForceScene` in `forceScene.ts`, run on the same world with the vehicle at the same spot and scale) cross-fades in and keeps zooming out. At the handoff a ring orbits the vehicle, cycling Perceive → Believe → Assess risk → Plan → Act; it fades as the view widens. Chapters: **Fieldcore OS** (the autonomy on every machine, many bodies), autonomous teams, human–machine teaming, and **Shunya OS**, the mission intelligence layer above it (swarm orchestration, AI-assisted mission planning, fleet management).
  5. **09 Fieldcore OS:** under-canopy reconnaissance, fixed-wing, underground and pilot-assistance demos, see below.
  6. Closing CTA.
- **Implementation:** vanilla Three.js with one terrain mesh and a custom shader driven by scroll keyframes (`KEYS` → `SceneState`, including `comm` and `bev` for the handoff; the lead vehicle's progress `drive` is tied linearly to scroll so it arrives at the goal smoothly). `worldA.ts` holds the shared world options, goal and Shunya OS node so the 3D and 2D views line up. If WebGL is unavailable, a Canvas 2D fallback is used.
- **Scene annotations:** Perception, Belief and Risk show plain-language HTML callouts pointing to sensor returns, mapped contours and raised risk peaks. They hide immediately during scrolling and reappear after a 450 ms pause once the scene has settled. Each visible callout stays attached to one terrain feature. No-WebGL mode keeps the explanatory rail without misleading 3D arrows.
- **Placeholder vs production-ready:** procedural terrain, line-art machines and proof renders are placeholders; the scroll/scene architecture, handoff and fallbacks are close to production. Tune on real GPUs and do a mobile art-direction pass before launch.

### Fieldcore OS chapter (Scout the route / Stay unseen / Explore safely / Land safely tabs)

Inspired by a reference risk-estimation capture kept locally in `reference_material/` (git-ignored; **not** committed, embedded or shipped).

- **Product framing:** a persistent **Fieldcore OS · In development** heading owns the development status. The four tabs are labelled as applications of the same autonomy system.
- **Under-canopy route reconnaissance (first tab):** a quadrotor launches from a parked UGV's deck and scouts a dense forest for hazards and choke points. It investigates fallen timber and a steep drainage cut, then scouts the eastern corridor through to the exit. The scouted route gains a green surface highlight and a **Low risk** label before the UGV moves. The camera hands over to follow the UGV along that corridor, with the ground team behind it. `src/lib/forestRecon.ts` shares the seeded tree layout, terrain, route scores, launch height, flight, observation frontier and vehicle/team handoff; `forestScene.ts` and `forestMap2d.ts` render the same sequence in WebGL and Canvas.
- **Ground tab:** no GPS, no light, no map. A chase camera follows the rover to a fork. It starts down the short direct branch, sees a drop (only visible up close), reverses out and takes the long, low-risk detour.
- **Air tab:** `src/components/candidate-a/airScene.ts`. A fixed-wing machine flies low through a canyon, detects a radar (electronic warfare risk) covering its planned branch, and re-plans into the other canyon, keeping terrain between itself and the emitter.
- **Pilot assistance tab:** `src/components/candidate-a/landingScene.ts`. A gear-mounted optical camera looks forward beneath a manned aircraft through dusk and fog. Landing lights reveal textured soil, gravel, stones and stubble at short range; the undercarriage frames the image. The risk view evaluates 128 sampled approaches (64 on lower-power devices), colors them by terrain/control cost and exponential importance weight, and draws their weighted mean. The sampled horizon begins at the current aircraft pose, concentrates around the accepted corridor, and closes as the aircraft touches down. `src/lib/landing.ts` shares the height field, slope/roughness measurements, clearance, relative corridor scores and motion. The MPPI-style sampling is an illustrative assessment, not a flight controller. Reduced motion freezes temporal grain and resampling; the Canvas fallback preserves the dark camera treatment and trajectory cloud.
- **Interaction:** a pinned split screen. Scrolling plays under-canopy reconnaissance, fixed-wing, underground, then pilot assistance; scrolling back reverses the sequence. Tabs jump to the start of each demo and support arrow keys, Home and End. Each demo gets its own full scroll range. Four tabs use a two-row layout on mobile. Underground, scrolling drives the machine to the fork, holds while both routes are assessed, then drives the detour. Without WebGL, reconnaissance, underground and pilot assistance remain available with Canvas fallbacks and three scroll ranges.
- **Implementation:** `src/lib/passage.ts` is a deterministic passage model (entry tunnel, fork, a direct branch with a drop and rubble, a winding detour, goal chamber, range sensor with occlusion, per-cell first/best observation). `deepScene.ts` draws both viewports from one WebGL context. `passageMap2d.ts` is the Canvas fallback and the "confined passage" proof placeholder.

---

## Shared placeholders (replace before launch)

- `src/config/site.ts`: shared company name (`RTA Systems`) and wordmark (`RTA SYSTEMS`); `contactFormKey` is the Web3Forms access key behind the contact form (`src/components/shared/ContactDialog.astro`); the Contact, Partner with us and Join the team buttons open that form, and no email address is shown on the site.
- `src/config/proof.ts` and `src/components/shared/ProofReel.astro`: proof items currently render procedural Canvas simulations labelled *"Placeholder — replace with capture"*. Put real MP4/WebM clips in `public/assets/proof/` and set `src` on each item.
- `public/favicon.svg`: temporary mark.
- Pages are marked `noindex` in `src/layouts/Base.astro`.

## Performance and accessibility notes

- Heavy visuals load after first paint, and render loops run only while visible (`visibleLoop`).
- No large textures or models: all terrain is procedural, and the total JS for each page is small. Run `npm run build` to see per-page bundles.
- Canvas fallbacks when WebGL is unavailable, and `prefers-reduced-motion` support (continuous animations are disabled and scrubs are snappier).
- Headlines and captions are real HTML text, not baked into canvases.
