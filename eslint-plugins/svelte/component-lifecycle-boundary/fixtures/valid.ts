import { onMount } from "svelte";
import { getDispatch } from "@augmentcode/themis/svelte-store";

const dispatch = getDispatch();

onMount(() => {
  dispatch({ type: "todos/load" });
});