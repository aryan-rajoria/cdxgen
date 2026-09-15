import { error } from "@sveltejs/kit";

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch, setHeaders }) {
  const res = await fetch("https://api.example.com/items");
  if (!res.ok) {
    error(res.status, "Could not load items");
  }
  setHeaders({ "cache-control": "max-age=60" });
  return (await res.json()) ?? { items: [] };
}
