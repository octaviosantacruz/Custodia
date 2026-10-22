# CSS ownership

This directory keeps the small set of styles that intentionally apply across
the application. It is not a second generic component library.

- `foundation.css` owns tokens, theme values and HTML-level defaults.
- `application-shell.css` owns the global application frame: header, product
  navigation, command search and shared overflow controls.
- `motion.css` owns shared transitions and reduced-motion handling.
- `../styles.css` keeps only what several domains genuinely share: element
  defaults (`td`, `h2`), base controls (`.button`, `.inline-select`), the KPI
  band, the shared empty/loading/error state and a few legacy rules whose
  cascade could not be moved without changing the result. New source- or
  workspace-specific rules must not be added there.

## Where a rule lives

Place a rule with the component that renders its class: `foo-bar.tsx` owns
`foo-bar.css` next to it and imports it. Families used by several components of
one tool live in a CSS named after the family (`safe-table.css`,
`dashboard-widget.css`) and every user imports it. Do not create a file for a
handful of lines; add them to the CSS of the nearest family.

Primitives shared by several tools (`cell-stack`, `database-surface`,
`catalog-modal`, `detail-drawer`, `personal-dashboard`, `workspace-subnav`,
`identity-connection`, `app-notifications`, `notification-menu`) are imported
from `main.tsx`, after the global styles. A component whose CSS would be loaded
only by a different lazy chunk must not own a class that other chunks use.

## Cascade order (read before moving anything)

The order in which stylesheets reach the browser decides every tie between two
rules of equal specificity:

1. CSS imported by statically bundled components (everything `App.tsx` reaches
   without `lazy()`), because `App` is imported first in `main.tsx`.
2. `foundation.css`, `styles.css`, `application-shell.css`, `motion.css`.
3. The imports at the end of `main.tsx`.
4. CSS of lazy workspaces, in chunk load order (not guaranteed between chunks).

Consequences:

- A rule moved out of `styles.css` into a statically bundled component CSS
  jumps from group 2 to group 1 and starts to lose against the rules left in
  `styles.css`. Move it to a lazy CSS, import it from `main.tsx`, or raise its
  specificity deliberately (for example `.button.auth-submit`).
- Moving into a file that already existed: if the file loads before
  `styles.css`, append the moved rules after the existing ones; if it loads
  after, put them before. Never merge blindly.
- Equal specificity plus the same property on elements that carry both classes
  is the only case where order matters. Verify those pairs; do not rely on
  names.
- Delete a declaration that a later rule with the exact same selector always
  overrides, and a rule whose class no longer appears in any `.tsx`.
  Third-party classes (`lucide-*`, `react-aria-*`) are not dead.

## Verification

`npm run verify` runs `verify:styles`, which has two parts:

- `verify-style-ownership.mjs` checks the imports for the migrated workspace
  styles and prevents `styles.css` from growing (`maxSharedStyleLines`). Lower
  that number whenever lines leave the file.
- `verify-style-cascade.mjs` (logic in `scripts/lib/style-cascade.mjs`, with unit
  tests) fails when a component uses a class whose only stylesheet is loaded by
  another chunk, and when any stylesheet defines a class that no component
  mentions. Classes counted as used are those inside `className`; the rule
  anchor is the first class of each selector.

It does not detect an order inversion between two rules of equal specificity;
that still needs the manual check described above (see `FE-CSS-002`). If a
shared rule genuinely needs to be added, extract or retire an equivalent
legacy rule in the same change and document the ownership here.

A pure move is correct only if the multiset of rules is unchanged (same
selector and declarations before and after) and a pixel comparison of the main
screens, in dark and light, shows no difference. Screens that need extra
state (login, toasts, modals, drawers) must be exercised explicitly: a
screenshot of an empty state proves nothing about them.
