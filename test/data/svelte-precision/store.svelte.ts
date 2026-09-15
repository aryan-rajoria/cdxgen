// A `.svelte.ts` module: runes outside a component file. This module never
// imports from "svelte", yet it cannot compile without the svelte compiler,
// so rune usage alone must mark `svelte` required.
export function createCounter(initial = 0) {
  let count = $state(initial);
  let history = $state<number[]>([]);

  function increment(): number {
    history = [...history, count];
    count += 1;
    return count;
  }

  function undo(): number {
    const previous = history[history.length - 1];
    if (previous !== undefined) {
      count = previous;
      history = history.slice(0, -1);
    }
    return count;
  }

  return {
    get count(): number {
      return count;
    },
    increment,
    undo,
  };
}

export const STEP_LIMIT = 100;
