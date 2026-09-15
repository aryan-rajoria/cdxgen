<script>
  import { createEventDispatcher } from "svelte";

  export let todos = [];

  const dispatch = createEventDispatcher();
</script>

<ul>
  {#each todos as todo (todo.id)}
    <li>
      <button on:click={() => dispatch("toggle", { id: todo.id })}>
        {todo.done ? "redo" : "do"}: {todo.title}
      </button>
    </li>
  {/each}
</ul>

<slot let:remaining>
  <small>{remaining} remaining</small>
</slot>
