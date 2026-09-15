<script lang="ts">
  import { fetchProfile } from "./api-client.ts";
  import dayjs from "dayjs";

  let userId = $state("u-42");
  let profilePromise = $derived(fetchProfile(userId));
  let since = $derived(dayjs().format("HH:mm"));
</script>

<input bind:value={userId} placeholder="user id" />

{#await profilePromise}
  <p class="pending">loading... (since {since})</p>
{:then profile}
  <h2>{profile.name}</h2>
  <dl>
    <dt>Email</dt>
    <dd>{profile.email}</dd>
  </dl>
{:catch error}
  <p class="error">failed: {error.message}</p>
{/await}

{#key userId}
  <span class="keyed">viewing {userId}</span>
{/key}
