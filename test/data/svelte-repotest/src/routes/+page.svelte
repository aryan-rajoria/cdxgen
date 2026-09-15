<script lang="ts">
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import dayjs from "dayjs";
  import { z } from "zod";
  import { page } from "$app/stores";
  import { PUBLIC_API_URL } from "$env/static/public";
  import Chart from "$lib/Chart.svelte";

  const ItemSchema = z.object({ name: z.string() });
  let items = $state<string[]>([]);
  const loading = writable(true);

  onMount(async () => {
    const res = await fetch(`${PUBLIC_API_URL}/items`);
    items = ItemSchema.array().parse(await res.json()).map((i) => i.name);
    loading.set(false);
  });
</script>

<h1>Dashboard {dayjs().format("YYYY-MM-DD")}</h1>

{#if $loading}
  <p>Loading…</p>
{:else}
  <ul>
    {#each items as item, i (item)}
      <li class="row {i % 2 === 0 ? 'even' : 'odd'}">
        {@html item}
      </li>
    {/each}
  </ul>
{/if}

<button on:click={() => (items = [])}>Clear</button>
<Chart data={items} />

<p>Path: {$page.url.pathname}</p>

<style lang="scss">
  @use "bulma/sass/utilities" as utils;
  .row {
    color: utils.$primary;
  }
</style>
