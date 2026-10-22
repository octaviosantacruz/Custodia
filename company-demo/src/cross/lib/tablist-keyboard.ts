import type { KeyboardEvent } from 'react';

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/* Roving-tabindex keyboard navigation for the WAI-ARIA tablist pattern.
   Attach to the element carrying role="tablist"; operates on its
   role="tab" descendants directly via the DOM, so no extra refs or state
   are needed at each call site. Uses "automatic activation" (moving focus
   also activates the tab) since every tablist in this app is a lightweight
   view switcher, not a multi-step form where accidental activation would
   be costly. Pair with tabIndex={selected ? 0 : -1} on each tab so Tab
   enters/exits the tablist as a single stop, per the APG tablist pattern. */
export function handleTablistKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (!NAVIGATION_KEYS.has(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  if (!tabs.length) return;
  const currentIndex = tabs.indexOf(document.activeElement as HTMLElement);
  if (currentIndex === -1) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;

  if (nextIndex === currentIndex) return;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  nextTab.focus();
  nextTab.click();
}
