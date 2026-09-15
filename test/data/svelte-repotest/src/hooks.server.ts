import { redirect } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";

/** @type {import('@sveltejs/kit').Handle} */
const authHandle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/admin") && !event.cookies.get("session")) {
    redirect(303, "/");
  }
  return resolve(event);
};

/** @type {import('@sveltejs/kit').HandleFetch} */
export const handleFetch = async ({ event, request, fetch }) => {
  if (request.url.startsWith("https://api.example.com/")) {
    request.headers.set("x-origin", event.url.origin);
  }
  return fetch(request);
};

export const handle = sequence(authHandle);
