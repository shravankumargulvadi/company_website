import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/forestRecon.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const {
  createForestRecon, forestHeight, forestState, forestScoutPose, forestTeamPose, forestUgvPose, FOREST_LAUNCH_HEIGHT,
  forestObservationSamples, forestObservedAt,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const model = createForestRecon();

test('forest layout and route selection are deterministic and grounded in obstacle clearance', () => {
  assert.deepEqual(createForestRecon(), model);
  assert.ok(model.trees.length > 400);
  assert.equal(model.best.id, 'flank');
  assert.equal(model.best.score, Math.min(...model.routes.map(route => route.score)));
  const direct = model.routes.find(route => route.id === 'direct');
  const drainage = model.routes.find(route => route.id === 'drainage');
  assert.ok(direct.length < model.best.length);
  assert.ok(direct.clearance < 0.8 && direct.score > 80);
  assert.ok(drainage.slope > 25 && model.best.slope < 8);
  assert.ok(model.best.clearance > 2);
});

test('quadrotor launches below the canopy and continuously scouts without hitting tree trunks', () => {
  let previous = forestScoutPose(model, 0);
  for (let i = 0; i <= 3000; i++) {
    const pose = forestScoutPose(model, i / 3000);
    const altitude = pose.y - forestHeight(pose.x, pose.z);
    assert.ok(altitude >= FOREST_LAUNCH_HEIGHT - 0.001 && altitude <= 2.801);
    assert.ok(Math.hypot(pose.x - previous.x, pose.y - previous.y, pose.z - previous.z) < 0.12);
    for (const tree of model.trees) assert.ok(Math.hypot(pose.x - tree.x, pose.z - tree.z) - tree.radius > 1.5);
    previous = pose;
  }
  const final = forestScoutPose(model, 1);
  assert.equal(final.x, model.goal.x); assert.equal(final.z, model.goal.z);
});

test('drone starts on the UGV deck and the vehicle waits for the low-risk route before moving', () => {
  const parked = forestUgvPose(model, 0), drone = forestScoutPose(model, 0);
  assert.equal(drone.x, parked.x); assert.equal(drone.z, parked.z);
  assert.ok(Math.abs(drone.y - parked.y - FOREST_LAUNCH_HEIGHT) < 1e-9);
  const airborne = forestScoutPose(model, 0.1);
  assert.ok(airborne.y > drone.y + 1.5);
  for (const p of [0.1, 0.5, 0.8, 0.86, 0.89]) assert.deepEqual(forestUgvPose(model, p), parked);
  assert.equal(forestState(0.89).recommended, 1);
  const moved = forestUgvPose(model, 0.98);
  assert.ok(Math.hypot(moved.x - parked.x, moved.z - parked.z) > 35);
  assert.equal(moved.y, forestHeight(moved.x, moved.z));
  const samples = forestObservationSamples(model);
  assert.ok(forestObservedAt(samples, moved.x, moved.z) < 0.8);
  assert.deepEqual(forestUgvPose(model, 0.5), parked, 'reverse scrolling restores the parked vehicle');
});

test('hazards and the complete recommended corridor are observed before the handoff', () => {
  const samples = forestObservationSamples(model);
  for (const hazard of model.hazards) assert.ok(forestObservedAt(samples, hazard.x, hazard.z) < 0.5);
  for (const p of model.best.points) assert.ok(forestObservedAt(samples, p.x, p.z) <= 0.8);
  assert.equal(forestState(0.8).recommended, 0);
  assert.equal(forestState(0.86).recommended, 1);
  assert.equal(forestObservedAt(samples, -36, 0), 2, 'unvisited forest remains unknown');
});

test('ground team holds until reconnaissance is handed back, then follows the scouted route', () => {
  const waiting = forestTeamPose(model, 0);
  for (const progress of [0.2, 0.5, 0.8, 0.86]) assert.deepEqual(forestTeamPose(model, progress), waiting);
  const moving = forestTeamPose(model, 0.96);
  assert.ok(Math.hypot(moving.x - waiting.x, moving.z - waiting.z) > 20);
  const scout = forestScoutPose(model, 0.96);
  assert.ok(Math.hypot(moving.x - scout.x, moving.z - scout.z) > 10, 'scout stays ahead');
  const before = forestScoutPose(model, 0.38);
  forestScoutPose(model, 1);
  assert.deepEqual(forestScoutPose(model, 0.38), before, 'scrolling backward restores the same scout pose');
});
