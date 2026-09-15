<script lang="ts">
  // TypeScript is allowed in template expressions only when the instance
  // script declares lang="ts"; this component pins that path.
  import type { Note } from "./types.ts";
  import { z } from "zod";

  let { note }: { note: Note } = $props();

  const bodySchema = z.string();

  function normalize(value: unknown): string {
    const parsed = bodySchema.safeParse(value);
    return parsed.success ? parsed.data.trim() : String(value ?? "").trim();
  }
</script>

<p>{(note.body as string).length} chars</p>
<p>{normalize(note.body!).toUpperCase()}</p>
