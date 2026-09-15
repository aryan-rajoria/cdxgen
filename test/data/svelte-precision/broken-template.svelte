<script lang="ts">
  // The template below contains a deliberately malformed expression
  // (`{ 1 + }`), which the Svelte parser rejects for the whole file. cdxgen
  // must still recover this component's script imports via the script-only
  // fallback path, at correct line numbers.
  import { nanoid } from "nanoid";

  export let seed = 1;

  function next(): number {
    return seed * 2;
  }

  function nextId(): string {
    return nanoid(6);
  }
</script>

<p>{next()}</p>
<p>{nextId()}</p>
<p>{ 1 + }</p>
