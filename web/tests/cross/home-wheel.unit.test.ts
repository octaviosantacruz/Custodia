import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_WHEEL_CENTER, HOME_WHEEL_CROWN_RADIUS, HOME_WHEEL_RADIUS, HOME_WHEEL_STAGE, orbitPositions, radialOrbitLayout, wheelNodeSize, wheelRay } from '../../src/cross/lib/home-wheel.ts';

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angleOf(point: { x: number; y: number }): number {
  return (Math.atan2(point.y - HOME_WHEEL_CENTER.y, point.x - HOME_WHEEL_CENTER.x) * 180) / Math.PI;
}

test('count = 0 returns an empty array', () => {
  assert.deepEqual(orbitPositions(0, 0), []);
  assert.deepEqual(orbitPositions(-3, 0), []);
});

test('count = 1 places a single point at startAngle', () => {
  const [point] = orbitPositions(1, 0);
  assert.equal(point.x, round(HOME_WHEEL_CENTER.x + HOME_WHEEL_RADIUS));
  assert.equal(point.y, HOME_WHEEL_CENTER.y);
});

test('orbitPositions is deterministic', () => {
  const first = orbitPositions(3, 90);
  const second = orbitPositions(3, 90);
  assert.deepEqual(first, second);
});

test('every point sits at the same radius from the centre', () => {
  const points = orbitPositions(5, 12);
  for (const point of points) {
    assert.ok(Math.abs(distance(point, HOME_WHEEL_CENTER) - HOME_WHEEL_RADIUS) < 0.01);
  }
});

test('3 nodes land 120° apart', () => {
  const points = orbitPositions(3, 90);
  const angles = points.map(angleOf).map((angle) => (angle + 360) % 360);
  const sorted = [...angles].sort((a, b) => a - b);
  const diffs = sorted.map((angle, index) => (sorted[(index + 1) % sorted.length] - angle + 360) % 360);
  for (const diff of diffs) {
    assert.ok(Math.abs(diff - 120) < 0.01, `expected 120°, got ${diff}`);
  }
});

test('4 nodes land 90° apart', () => {
  const points = orbitPositions(4, 0);
  const angles = points.map(angleOf).map((angle) => (angle + 360) % 360);
  const sorted = [...angles].sort((a, b) => a - b);
  const diffs = sorted.map((angle, index) => (sorted[(index + 1) % sorted.length] - angle + 360) % 360);
  for (const diff of diffs) {
    assert.ok(Math.abs(diff - 90) < 0.01, `expected 90°, got ${diff}`);
  }
});

test('coordinates stay within the stage', () => {
  const points = orbitPositions(6, 37);
  for (const point of points) {
    assert.ok(point.x >= 0 && point.x <= HOME_WHEEL_STAGE.width);
    assert.ok(point.y >= 0 && point.y <= HOME_WHEEL_STAGE.height);
  }
});

test('the three-node wheel keeps CyberArk upper-right, Netskope upper-left and BigID at the bottom', () => {
  const [bigid, netskope, cyberark] = orbitPositions(3, 90);
  assert.ok(bigid.y > HOME_WHEEL_CENTER.y && Math.abs(bigid.x - HOME_WHEEL_CENTER.x) < 0.01, 'BigID is centred below the hub');
  assert.ok(netskope.x < HOME_WHEEL_CENTER.x && netskope.y < HOME_WHEEL_CENTER.y, 'Netskope sits upper-left');
  assert.ok(cyberark.x > HOME_WHEEL_CENTER.x && cyberark.y < HOME_WHEEL_CENTER.y, 'CyberArk sits upper-right');
});

test('wheelRay computes the length and angle of a diagonal ray via atan2', () => {
  const [, , cyberark] = orbitPositions(3, 90);
  const ray = wheelRay(HOME_WHEEL_CENTER, cyberark);
  assert.ok(Math.abs(ray.length - HOME_WHEEL_RADIUS) < 0.01);
  const expectedAngle = (Math.atan2(cyberark.y - HOME_WHEEL_CENTER.y, cyberark.x - HOME_WHEEL_CENTER.x) * 180) / Math.PI;
  assert.ok(Math.abs(ray.angleDeg - expectedAngle) < 0.01);
  assert.ok(ray.angleDeg < 0, 'CyberArk sits above the centre, a negative (upward) angle');
});

test('HOME-WHEEL-002 distributes the tool crown uniformly on a deterministic 2D circle', () => {
  const [bottom, upperLeft, upperRight] = radialOrbitLayout(3, 90);

  assert.equal(bottom.angleDeg, 90);
  assert.equal(bottom.position.x, HOME_WHEEL_CENTER.x);
  assert.ok(bottom.position.y > HOME_WHEEL_CENTER.y);
  assert.ok(upperLeft.position.x < HOME_WHEEL_CENTER.x);
  assert.ok(upperRight.position.x > HOME_WHEEL_CENTER.x);
  assert.equal(upperLeft.position.y, upperRight.position.y);
  for (const node of [bottom, upperLeft, upperRight]) {
    assert.ok(Math.abs(distance(node.position, HOME_WHEEL_CENTER) - HOME_WHEEL_CROWN_RADIUS) < 0.01);
  }
  assert.deepEqual(radialOrbitLayout(3, 90), radialOrbitLayout(3, 90));
});

test('HOME-WHEEL-002 keeps the explicit node-density policy and rejects a ninth flat-orbit node', () => {
  assert.equal(wheelNodeSize(1), 84);
  assert.equal(wheelNodeSize(4), 84);
  assert.equal(wheelNodeSize(5), 72);
  assert.equal(wheelNodeSize(6), 72);
  assert.equal(wheelNodeSize(7), 62);
  assert.equal(wheelNodeSize(8), 62);
  assert.throws(() => wheelNodeSize(9), /hierarchical navigation/i);
  assert.throws(() => radialOrbitLayout(9, 90), /hierarchical navigation/i);
});

test('HOME-WHEEL-002 radial nodes stay inside and do not collide on the 440px desktop stage', () => {
  const stagePixels = 440;
  const stageUnitsPerPixel = HOME_WHEEL_STAGE.width / stagePixels;
  for (let count = 1; count <= 8; count += 1) {
    const layout = radialOrbitLayout(count, 90);
    for (const node of layout) {
      const halfSize = (node.nodeSize * stageUnitsPerPixel) / 2;
      assert.ok(node.position.x - halfSize >= 0 && node.position.x + halfSize <= HOME_WHEEL_STAGE.width, `node inside x bounds for N=${count}`);
      assert.ok(node.position.y - halfSize >= 0 && node.position.y + halfSize <= HOME_WHEEL_STAGE.height, `node inside y bounds for N=${count}`);
    }
    for (let left = 0; left < layout.length; left += 1) {
      for (let right = left + 1; right < layout.length; right += 1) {
        const minimumDistance = ((layout[left].nodeSize + layout[right].nodeSize) * stageUnitsPerPixel) / 2;
        assert.ok(distance(layout[left].position, layout[right].position) > minimumDistance, `nodes ${left}/${right} do not collide for N=${count}`);
      }
    }
  }
});

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
