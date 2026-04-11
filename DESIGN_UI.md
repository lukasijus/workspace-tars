# UI Design Taste Guide

This file is for coding agents and assistants that generate UI. It is intentionally portable across projects: follow it unless a project-specific design system says otherwise.

## Direction

Build interfaces that feel like useful tools.

The default taste is:

- minimal
- calm
- readable
- operator-friendly
- slightly dense
- restrained with decoration
- clear in hierarchy

Prefer a dashboard that feels reliable over one that feels “designed.” The user should understand what changed, what needs attention, and what action is safe to take.

## Core Rules

- Use layout, spacing, typography, and alignment before adding decoration.
- Add backgrounds, borders, shadows, and rounded containers only when they clarify grouping or state.
- Do not turn every clickable thing into a card.
- Do not add helper text below every label unless it solves a real comprehension problem.
- Do not use oversized rounded pills as the default shape for navigation or table controls.
- Prefer subtle active states over loud backgrounds.
- Use one accent color at a time. Let status colors mean status, not decoration.
- Keep scan speed high. If a user needs to compare many rows, reduce visual noise.
- Preserve whitespace, but do not waste it.
- Keep icons secondary. Icons support labels; they should not dominate.

## Dashboard Rules

Dashboards are work surfaces, not landing pages.

- Main list pages should be lightweight and scannable.
- Detail pages can hold complexity, logs, snapshots, JSON, and secondary metadata.
- Metrics can use cards because they summarize state.
- Tables should prioritize readable rows, compact status, and predictable actions.
- Action buttons should be obvious but not loud.
- Status chips should communicate state without dominating the row.
- If a table cell starts becoming a paragraph, move that detail to the item page.
- Prefer row click-through for detail, then put deeper actions on the detail page.

## Navigation Rules

Navigation should feel stable and quiet.

Do:

- Use a compact icon plus a clear label.
- Use a subtle active indicator, tint, or left border.
- Keep nav item height modest.
- Keep nav labels short.
- Group future sections only when they exist or when the group helps scanning.
- Use tooltips or detail pages for explanation, not repeated helper text in every nav item.

Do not:

- Wrap each nav item in a large rounded card by default.
- Add a title plus a sentence under every nav item.
- Use heavy shadows or high-contrast pills for normal nav states.
- Make inactive nav items compete visually with primary content.
- Add disabled future pages just to show a roadmap.

Good sidebar item:

```text
[icon] Dashboard
```

Good active state:

```text
| [icon] Dashboard
```

Avoid:

```text
( large rounded background )
[icon] Dashboard
Application queue, actions, and recent workflow state.
```

The avoided version may be acceptable for a special feature card, but it is too heavy for normal navigation.

## Component Taste

Use the simplest component that communicates the job.

- `Card`: for grouped content, metrics, summaries, and detail sections.
- `Chip`: for short status labels only.
- `Button`: for explicit actions.
- `IconButton`: for compact utility actions with accessible labels.
- `Table`: for comparing many records.
- `List`: for navigation or compact sets of related items.
- `Drawer`: for app-level navigation, not content decoration.

If a component starts needing many nested wrappers, step back and simplify the visual idea.

## Typography

- Prefer clear hierarchy over many font sizes.
- Use strong weight sparingly.
- Avoid bolding everything important. If everything is bold, nothing is bold.
- Keep labels short and concrete.
- Avoid marketing copy in operational UI.
- Use sentence case unless the existing product style says otherwise.

## Spacing And Shape

- Use consistent spacing steps.
- Keep radii moderate.
- Use full pill shapes only for chips, tags, or intentionally pill-shaped controls.
- Avoid nested rounded containers unless there is a clear parent-child grouping.
- Prefer thin borders or subtle background shifts over deep shadows.

## Color

- Use neutral backgrounds for most surfaces.
- Use accent color for primary navigation and main actions.
- Use semantic colors for statuses:
  - green: done/success
  - yellow/orange: needs attention
  - red: failed/destructive
  - blue: active/in progress
  - gray: inactive/neutral
- Do not invent random colors per component.
- Do not use bright gradients inside operational content unless the whole product direction calls for it.

## Motion

- Motion should explain state changes, not decorate.
- Use minimal transitions for hover, drawer open/close, and loading states.
- Avoid bouncing, excessive fades, or unrelated micro-animations in dashboards.

## Agent Workflow

Before adding UI:

- Check existing layout primitives and components first.
- Ask whether the new element is navigation, content, action, state, or decoration.
- If it is decoration, remove it unless it improves comprehension.

After adding UI:

- Inspect it visually, preferably with a screenshot or browser run.
- Look for accidental card soup, badge soup, and helper-text clutter.
- Check narrow and desktop widths.
- Confirm the most important action or state is still obvious.
- If the component feels embarrassing, simplify it before calling the work done.

## Acceptance Test

The UI change is acceptable when:

- the user can scan it quickly
- the layout feels intentional
- the component does not draw more attention than its importance deserves
- repeated elements stay compact
- details live in detail views, not list rows
- the UI still feels calm after real data is loaded

