<script module>
  export const prerender = true;
</script>

<script>
  import { nanoid } from "nanoid";
  import { navigating } from "$app/stores";

  const runId = nanoid();
</script>

{#if $navigating}
  <div class="progress" data-run={runId}></div>
{/if}

<slot />
