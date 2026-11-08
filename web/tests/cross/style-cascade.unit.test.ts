import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorClasses, findDeadClasses, findUnreachedStyleUsers, selectorClasses } from '../../scripts/lib/style-cascade.mjs';

const main = `import './styles.css';\nimport { App } from './App';\nimport './shared/primitive.css';`;
const baseFiles: Record<string, string> = {
  'src/main.tsx': main,
  'src/App.tsx': `import { lazy } from 'react';\nconst A = lazy(() => import('./a/a-workspace'));\nconst B = lazy(() => import('./b/b-workspace'));`,
  'src/styles.css': '.button { color: red; }',
  'src/shared/primitive.css': '.cell-stack { display: grid; }',
  'src/a/a-workspace.tsx': `import './a-workspace.css';\nexport const A = () => <div className="a-panel button" />;`,
  'src/a/a-workspace.css': '.a-panel { gap: 4px; }\n.a-panel .a-item { margin: 0; }',
  'src/b/b-workspace.tsx': `import './b-workspace.css';\nexport const B = () => <div className="b-panel cell-stack" />;`,
  'src/b/b-workspace.css': '.b-panel { gap: 2px; }',
};
const globalStyles = ['src/styles.css'];

test('selectorClasses reads selectors only, never declaration values', () => {
  const css = '.a, .b > .c:hover { background: url(x.png); }\n@media (min-width: 1px) { .d .e { color: red; } }';
  assert.deepEqual([...selectorClasses(css)].sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('anchorClasses keeps the first class of each selector and ignores :is()/:not() arguments', () => {
  const css = '.identity-drawer .detail-value { color: red; }\n.table :is(.cell-lead, .cell-sub) { overflow: hidden; }';
  assert.deepEqual([...anchorClasses(css)].sort(), ['identity-drawer', 'table']);
});

test('a component that imports its CSS, and the shared CSS loaded from main, are reachable', () => {
  assert.deepEqual(findUnreachedStyleUsers(baseFiles, { mainEntry: 'src/main.tsx', globalStyles }), []);
});

test('a component that uses a class defined only by another lazy chunk is reported', () => {
  const files = { ...baseFiles, 'src/b/b-workspace.tsx': `import './b-workspace.css';\nexport const B = () => <div className="b-panel a-panel" />;` };
  const problems = findUnreachedStyleUsers(files, { mainEntry: 'src/main.tsx', globalStyles });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].user, 'src/b/b-workspace.tsx');
  assert.deepEqual(problems[0].classes, ['a-panel']);
});

test('a class styled only inside an ancestor of another component is not a dependency', () => {
  const files = { ...baseFiles, 'src/b/b-workspace.tsx': `import './b-workspace.css';\nexport const B = () => <div className="b-panel a-item" />;` };
  assert.deepEqual(findUnreachedStyleUsers(files, { mainEntry: 'src/main.tsx', globalStyles }), []);
});

test('a child chunk inherits the styles of the module that lazy-loads it', () => {
  const files = {
    ...baseFiles,
    'src/a/a-workspace.tsx': `import './a-workspace.css';\nconst Inner = lazy(() => import('./a-inner'));\nexport const A = () => <Inner />;`,
    'src/a/a-inner.tsx': `export const Inner = () => <div className="a-panel" />;`,
  };
  assert.deepEqual(findUnreachedStyleUsers(files, { mainEntry: 'src/main.tsx', globalStyles }), []);
});

test('ordinary words in code are not treated as class usage', () => {
  const files = { ...baseFiles, 'src/b/b-workspace.tsx': `import './b-workspace.css';\nconst a-panel = 1;\nexport const B = () => <div className="b-panel">{'a-panel'}</div>;` };
  assert.deepEqual(findUnreachedStyleUsers(files, { mainEntry: 'src/main.tsx', globalStyles }), []);
});

test('dead classes are reported, third-party and dynamic classes are not', () => {
  const files = {
    ...baseFiles,
    'src/styles.css': '.button { color: red; }\n.legacy-banner { color: blue; }\nsvg.lucide-user-x { opacity: 1; }\n.status-ok { color: green; }',
    'src/a/a-workspace.tsx': `import './a-workspace.css';\nexport const A = ({ tone }: { tone: string }) => <div className={\`a-panel button status-\${tone}\`} />;`,
  };
  assert.deepEqual(findDeadClasses(files, ['src/styles.css']), [{ css: 'src/styles.css', cls: 'legacy-banner' }]);
});
