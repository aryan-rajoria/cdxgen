<script context="module">
  // Module scope: evaluated once when the module is first imported.
  export const APP_VERSION = "1.0.0";
</script>

<script>
  import { writable } from "svelte/store";
  import { format } from "date-fns";
  import TodoList from "./components/TodoList.svelte";

  export let projectName = "legacy-app";

  const today = format(new Date(), "dd MMM yyyy");
  const clicks = writable(0);

  let todos = [{ id: 1, title: "ship the SBOM", done: false }];

  $: remaining = todos.filter((t) => !t.done).length;
  $: heading = `${projectName} (${APP_VERSION}) — ${today} — ${remaining} left`;

  function toggle(id) {
    todos = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
    clicks.update((n) => n + 1);
  }
</script>

<h1>{heading}</h1>

<TodoList {todos} on:toggle={(e) => toggle(e.detail.id)} />

<p>clicks so far: {$clicks}</p>
