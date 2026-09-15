<script module lang="ts">
  // Module scope: evaluated once when the module is first imported.
  import dayjs from "dayjs";

  export const GREETING_PREFIX = "hello";
  export const generatedAt: number = dayjs().year();

  export function formatName(first: string, last: string): string {
    return `${GREETING_PREFIX}, ${first} ${last}`;
  }
</script>

<script lang="ts">
  // Instance scope: evaluated per component instantiation.
  import type { Person } from "./types.ts";

  let { person }: { person: Person } = $props();

  let displayName = $derived(formatName(person.first, person.last));
</script>

<address>{displayName} &lt;{person.email}&gt; ({generatedAt})</address>
