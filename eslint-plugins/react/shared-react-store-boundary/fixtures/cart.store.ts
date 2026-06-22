import { signal, computed } from "@preact/signals-react";

export const cartItems = signal([]);
export const cartCount = computed(() => cartItems.value.length);

