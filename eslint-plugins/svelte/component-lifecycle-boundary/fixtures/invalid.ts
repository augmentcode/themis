import { onMount } from "svelte";
import { getDispatch } from "@augmentcode/themis/svelte-store";

onMount(() => {
  const dispatch = getDispatch();
  dispatch({ type: "todos/load" });
});