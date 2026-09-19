# Design

## Source of truth
- Status: Active; last refreshed: 2026-09-19.
- Primary surfaces: plain HTML/JavaScript resource platform and its lower-left 使用指南.
- Evidence: `apps/web/index.html`, `styles.css`, `app.js`; accepted interactive-guide brief in this task.

## Brand
- Practical Chinese teaching/administration tool; calm navy navigation and orange actions.
- Keep visible 演示模式 and 虚拟数据 labels. No institutional logo or real identities in examples.

## Product goals
- Teach users to perform the actual workflow through clicks and form entry, not a next-only slideshow.
- Success: correct actions advance, invalid actions explain, all lessons can finish and restart.
- Non-goals: changing production records, triggering upgrades, storing training activity on the server.

## Personas and jobs
- Members: orient, find/reserve equipment, cancel own reservation, reserve rooms, enter business records.
- Administrators: also manage members and laboratories. Developers: also rehearse upgrade workflow.
- Use selected role view for lesson filtering; tutorial roles confer no server permissions.

## Information architecture
- 使用指南 opens 边做边学 first; existing text reference tabs remain available.
- Lesson catalog → practice/demo → guided simulated workbench → completion and retry.

## Design principles
- One actionable instruction per step, highlight the target, keep the relevant UI visible.
- Practice never advances on the wrong action; examples explain expected input.
- Preserve actual navigation/field labels while simplifying unrelated UI.

## Visual language
- Reuse navy #1d2736, orange #bf512f, white cards, gray canvas; system Chinese fonts.
- Main tutorial text ≥14px, secondary ≥12px; clear borders and 8–12px radii.
- Motion limited to demonstration target feedback; respect reduced motion.

## Components
- Existing guide modal, role tabs, focus return. New sandboxed tutorial iframe and inline HTML classroom.
- Catalog cards, step coach, simulated sidebar/list/form, progress, pause, previous/restart/exit.

## Accessibility
- Labeled inputs, semantic buttons/forms, visible focus, status/error announcements.
- Keyboard flows and Escape exit; tutorial offers an explicit route back to text reference.
- No color-only instructions; examples and step titles accompany target highlighting.

## Responsive behavior
- Desktop: coach beside simulated workbench; narrow screens: coach above stage, wrapping controls.
- Tutorial scrolls internally without horizontal overflow at 390px; large enough touch targets.

## Interaction states
- Parent: loading, retry on load error, close/reopen with fresh state.
- Practice: validation error retains input and current step; completion lists learned skills.
- Demo: auto input/action, pause/resume; return to practice starts a fresh run; hidden document pauses.
- Back/restart deterministically restores virtual state. Leaving the panel destroys its timers/document.

## Content voice
- Direct, friendly Chinese; say where to click, what to enter and how to confirm the result.
- Use fictional names/resources, explicit sample date/time, and no production credentials.

## Implementation constraints
- No dependencies or frontend framework; a tutorial HTML file with inline CSS and one local classic script.
- Embedded through srcdoc with sandbox allow-same-origin only (no scripts/forms). A trusted host script mounts the simulator against its document. Child CSP denies scripts/connections/forms; production CSP stays unchanged.
- The simulator uses only its passed document and virtual state, never business APIs, storage or production data. Host callbacks only close the guide or open text help.
- Node behavioral tests plus browser desktop/mobile/isolation/keyboard checks before delivery.
- This development task does not publish a Release or switch production.

## Open questions
- No blocking questions. Release version and production rollout belong to a subsequent release task.
