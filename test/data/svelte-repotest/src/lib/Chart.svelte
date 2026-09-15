<script>
  import { Chart as ChartJs, registerables } from "chart.js";
  import { onDestroy } from "svelte";

  ChartJs.register(...registerables);

  export let data = [];
  let canvas;
  let chart;

  $: if (chart) {
    chart.data.labels = data;
    chart.update();
  }

  onDestroy(() => chart?.destroy());
</script>

{#if data.length}
  <canvas bind:this={canvas}></canvas>
{:else}
  <p>No data</p>
{/if}
