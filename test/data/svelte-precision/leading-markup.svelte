<!-- Markup before <script> is legal Svelte: the compiler hoists the instance
     script, so this still renders after `label` is initialised.

     This file pins the ordering contract. The root fragment's first child
     is this comment, at offset 0, so ordering program.body by offset would
     place the template statement ahead of the script. -->
<p data-role="lead">{label}</p>

<script lang="ts">
  import dayjs from "dayjs";

  export let label: string = "lead";

  const shout = (value: string): string => value.toUpperCase();

  export const shouted: string = shout(label);
  export const checkedAt: string = dayjs().toISOString();
</script>

<footer>{shouted} at {checkedAt}</footer>
