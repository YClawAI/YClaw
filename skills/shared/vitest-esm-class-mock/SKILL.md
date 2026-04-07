---
name: vitest-esm-class-mock
description: |
  How to mock class constructors (like WebClient from @slack/web-api) in vitest v4
  with ESM modules. Trigger: tests fail with "mock is not being treated as a constructor"
  or `new ClassName()` returns undefined after vi.clearAllMocks(). Solves the problem
  of vi.fn().mockImplementation() losing its implementation across test lifecycle hooks.
author: builder
version: 1.0.0
date: 2026-02-23
metadata:
  type: post-task
  department: development
---

# Vitest ESM Class Mock Pattern

## Problem

When mocking a class constructor in vitest v4 with ESM modules, using
`vi.fn().mockImplementation(() => ({...}))` as the mock is fragile. After
`vi.clearAllMocks()` runs between tests, the mock implementation can be
stripped, causing `new ClassName()` to return `undefined` instead of the
mock object.

## Context / Trigger Conditions

- **Error message:** "mock is not being treated as a constructor"
- **Symptom:** `new WebClient(token)` returns `undefined` in second+ test
- **Environment:** vitest v4, ESM (`"type": "module"`), `vi.mock()` with factory
- **Lifecycle:** `vi.clearAllMocks()` in `beforeEach` or `vi.restoreAllMocks()` in `afterEach`

## Solution

Use `vi.hoisted()` to declare mock functions, then use a **real class** (not `vi.fn()`)
as the mock constructor in the `vi.mock()` factory.

### Step 1: Declare mock functions with vi.hoisted()

```typescript
const { mockMethod1, mockMethod2 } = vi.hoisted(() => ({
  mockMethod1: vi.fn(),
  mockMethod2: vi.fn(),
}));
```

### Step 2: Use a real class in vi.mock() factory

```typescript
vi.mock('module-name', () => {
  class MockClassName {
    property1 = { method: mockMethod1 };
    property2 = { method: mockMethod2 };
  }
  return { ClassName: MockClassName };
});
```

### Step 3: Use vi.clearAllMocks() (not vi.restoreAllMocks())

```typescript
beforeEach(() => {
  vi.clearAllMocks(); // Clears call history, preserves implementations
});
```

## Why This Works

- `vi.hoisted()` runs before `vi.mock()` hoisting, so mock fns exist when the factory executes
- A real class is always constructable — no mock state can break `new ClassName()`
- `vi.clearAllMocks()` resets call counts on `mockMethod1`/`mockMethod2` but cannot
  break the class constructor itself
- `vi.restoreAllMocks()` would strip `mockImplementation` from a `vi.fn()` constructor,
  but has no effect on a real class

## Anti-Pattern (What NOT to Do)

```typescript
// ❌ FRAGILE — vi.fn().mockImplementation() can lose its implementation
vi.mock('module-name', () => ({
  ClassName: vi.fn().mockImplementation(() => ({
    property1: { method: mockMethod1 },
  })),
}));
```

## Verification

1. All tests in the describe block pass individually
2. All tests pass when run together (no test ordering issues)
3. `vi.clearAllMocks()` in `beforeEach` does not break subsequent tests

## Example

From `packages/core/tests/slack-history.test.ts` — mocking `@slack/web-api`'s `WebClient`:

```typescript
const { mockConversationsHistory, mockConversationsList, mockAuthTest } =
  vi.hoisted(() => ({
    mockConversationsHistory: vi.fn(),
    mockConversationsList: vi.fn(),
    mockAuthTest: vi.fn(),
  }));

vi.mock('@slack/web-api', () => {
  class MockWebClient {
    conversations = {
      history: mockConversationsHistory,
      list: mockConversationsList,
    };
    auth = { test: mockAuthTest };
  }
  return { WebClient: MockWebClient };
});
```

## Notes

- This pattern works for any class constructor mock, not just WebClient
- If you need to test constructor arguments, add a static `lastArgs` property to the mock class
- `vi.resetModules()` is unnecessary when using this pattern with dynamic imports
- See also: vitest docs on [vi.hoisted()](https://vitest.dev/api/vi.html#vi-hoisted)
