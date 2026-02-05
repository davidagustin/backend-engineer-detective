---
description: Project rules – TDD, verification, push when done, multi-agent, case quality
alwaysApply: true
---

# Project Rules

## TDD for New Features

When adding **new features**:

1. **Write tests first** – Before implementation, add or update tests that define the expected behavior.
2. **Implement to pass** – Write the minimal code needed to make those tests pass.
3. **Run verification** – Execute `npm run deploy` which runs TypeScript compilation. Confirm no type errors before considering the feature done.
4. **Fix failures** – If any errors occur, fix them until the build is clean; do not leave failing builds.

---

## Ralph Loop – Tasks Until Done

When working on a task:

1. **Loop until done** – Keep iterating until the task is fully complete. Do not stop with partial implementations.
2. **Verify before claiming completion** – Before saying the task is done:
   - Run `npm run deploy` and confirm it succeeds.
   - Test the feature manually in the browser if it's a UI change.
   - Only then treat the task as complete.
3. **No partial completion** – Deliver the full scope. If something is missing, fix it and re-verify.
4. **Use a todo list** – For multi-step work, track items and ensure every item is completed.

Do not claim completion without fresh verification evidence.

---

## Push When Done

When you finish a task that changes files:

1. **Stage** the relevant files (`git add`).
2. **Commit** with a clear message describing the work.
3. **Push** to the remote (`git push`).

Do this as the final step before telling the user the task is complete. Skip push if the user says "don't push".

---

## No Extra Markdown Files – README Only

- **Do not** create additional `.md` files unless they have functional value.
- **Consolidate** all documentation into **README.md**.
- **Delete stale planning files** – Remove task breakdowns and planning docs once completed.
- **Exception:** Rules files in `.claude/rules/*.md` are allowed.

---

## Multi-Agent Unique Tasks

When spawning multiple agents:

1. **Assign distinct work** – Each agent must have clearly different responsibilities.
2. **Partition by scope** – Split by file, feature, or component with no overlap.
3. **Avoid duplicate effort** – Confirm the task list has no duplicate entries.
4. **Name tasks clearly** – Label which agent does what.

Never assign the same task to more than one agent.

---

## Detective Case Quality Standards

When creating or modifying detective cases:

1. **Realistic scenarios** – Cases should reflect real-world production incidents that backend engineers actually encounter.
2. **Educational value** – Every case should teach a specific debugging skill, technology concept, or common pitfall.
3. **Clear clues** – Each clue should be distinct and provide useful information without giving away the answer.
4. **Accurate solutions** – Code examples must be syntactically correct and reflect actual best practices.
5. **Balanced difficulty** – Maintain a good mix across difficulty levels (junior, mid, senior, principal).
6. **Diverse categories** – Cover database, caching, networking, auth, memory, and distributed systems.

---

## Frontend Component Standards

For UI components:

1. **Use Lucide icons** – All icons should use Lucide via `window.lucide.createIcons()`.
2. **Dark theme** – Maintain the detective noir aesthetic (dark backgrounds, red/gold accents).
3. **No emojis in code** – Use icons instead of emoji characters.
4. **Mobile responsive** – Components should work on all screen sizes.
5. **Accessibility** – Include proper ARIA labels and keyboard navigation.

---

## API Response Standards

For API endpoints:

1. **Consistent JSON structure** – All responses should follow existing patterns.
2. **CORS headers** – Include `Access-Control-Allow-Origin: *` on all responses.
3. **Error handling** – Return meaningful error messages with appropriate status codes.
4. **Type safety** – All request/response types should be defined in `types.ts`.
