import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the TypeScript model with Node's built-in runner, without a browser.
const source = readFileSync(new URL('../src/lib/landing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createLandingAssessment, landingHeight, landingPose, landingState, sampleLandingTrajectories } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('three approaches share an aircraft origin and have distinct landing sites', () => {
  const { routes } = createLandingAssessment();
  assert.equal(routes.length, 3);
  for (const route of routes) {
    const p = route.points[0];
    assert.ok(Math.hypot(p.x, p.y - 29, p.z - 72) < 1e-9);
  }
  assert.equal(new Set(routes.map(route => route.touchdown.x)).size, 3);
});

test('selection uses the lowest measured risk, with roughness and clearance distinguishing alternatives', () => {
  const { routes, best } = createLandingAssessment();
  assert.equal(best.score, Math.min(...routes.map(route => route.score)));
  assert.equal(best.id, 'clearing');
  assert.ok(routes.find(route => route.id === 'ridge').clearance < 0, 'ridge blocks this approach');
  assert.ok(routes.find(route => route.id === 'rough').roughness > best.roughness * 10);
  assert.ok(routes.every(route => route.score >= 0 && route.score <= 100));
  assert.deepEqual(createLandingAssessment(), { routes, best }, 'assessment is deterministic');
});

test('selected flight stays above terrain and moves continuously through touchdown and rollout', () => {
  const { best } = createLandingAssessment();
  let previous = landingPose(best, 0);
  for (let i = 0; i <= 10000; i++) {
    const pose = landingPose(best, i / 10000);
    assert.ok(pose.y - landingHeight(pose.x, pose.z) >= 1.149, 'landing gear clears the surface');
    assert.ok(Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z) < 0.05, 'no jumps');
    previous = pose;
  }
  const touchdown = landingPose(best, 0.91);
  assert.deepEqual(touchdown, best.touchdown);
  assert.equal(landingPose(best, 1).z, best.touchdown.z - 12);
});

test('assessment completes before flight and reverses deterministically with scroll', () => {
  const state = landingState(0.56);
  assert.equal(state.decided, 1);
  assert.equal(state.flight, 0);
  const before = landingState(0.3);
  landingState(0.98);
  assert.deepEqual(landingState(0.3), before);
  for (const p of [-1, 0, 0.3, 0.7, 1, 2]) {
    assert.ok(Object.values(landingState(p)).every(value => value >= 0 && value <= 1));
  }
});

test('sampled trajectories share the current aircraft pose and carry normalized cost weights', () => {
  const assessment = createLandingAssessment();
  for (const progress of [0.3, 0.6, 0.8]) {
    const { rollouts, mean, effective } = sampleLandingTrajectories(assessment, progress, 128, 7);
    const origin = landingPose(assessment.best, progress);
    assert.equal(rollouts.length, 128);
    for (const rollout of rollouts) {
      const p = rollout.points[0];
      assert.ok(Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) < 1e-9);
      assert.ok(rollout.points.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
      assert.ok(Number.isFinite(rollout.cost) && rollout.weight >= 0);
    }
    assert.ok(Math.abs(rollouts.reduce((sum, r) => sum + r.weight, 0) - 1) < 1e-9);
    assert.ok(effective >= 1 && effective <= 128);
    assert.equal(mean.length, rollouts[0].points.length);
    assert.ok(Math.hypot(mean[0].x - origin.x, mean[0].y - origin.y, mean[0].z - origin.z) < 1e-9);
    assert.ok(mean.every(p => [p.x, p.y, p.z].every(Number.isFinite)));
    const ranked = [...rollouts].sort((a, b) => a.cost - b.cost);
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i].weight <= ranked[i - 1].weight);
  }
});

test('sampling concentrates around the accepted corridor and ends at touchdown', () => {
  const assessment = createLandingAssessment();
  const before = sampleLandingTrajectories(assessment, 0.3, 128, 4);
  const after = sampleLandingTrajectories(assessment, 0.65, 128, 4);
  const count = plan => plan.rollouts.filter(r => r.corridor === assessment.best.id).length;
  assert.ok(count(after) > count(before) * 2);
  assert.ok(after.rollouts.filter(r => r.corridor === assessment.best.id).reduce((sum, r) => sum + r.weight, 0) > 0.9);
  assert.deepEqual(sampleLandingTrajectories(assessment, 0.65, 128, 4), after);
  assert.notDeepEqual(sampleLandingTrajectories(assessment, 0.65, 128, 5).rollouts[0].points, after.rollouts[0].points);
  assert.equal(sampleLandingTrajectories(assessment, 1).rollouts.length, 0);
});
