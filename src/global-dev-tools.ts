import type { StoreRuntime } from "./store-runtime";

export type GlobalDevToolsStore = StoreRuntime<any, any>;

type SvelteReduxGlobal = {
  reduxContext?: GlobalDevToolsStore | GlobalDevToolsStore[];
};

type SvelteReduxWindow = Window & {
  svelteRedux?: SvelteReduxGlobal;
};

const getExistingSvelteReduxGlobal = (): SvelteReduxGlobal | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as SvelteReduxWindow).svelteRedux;
};

const getOrCreateSvelteReduxGlobal = (): SvelteReduxGlobal | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const svelteReduxWindow = window as SvelteReduxWindow;
  svelteReduxWindow.svelteRedux = svelteReduxWindow.svelteRedux || {};
  return svelteReduxWindow.svelteRedux;
};

export const cleanUpGlobalDevTools = (store: GlobalDevToolsStore): void => {
  const svelteRedux = getExistingSvelteReduxGlobal();
  if (!svelteRedux?.reduxContext) {
    return;
  }

  if (svelteRedux.reduxContext === store) {
    svelteRedux.reduxContext = undefined;
  }
  if (Array.isArray(svelteRedux.reduxContext)) {
    svelteRedux.reduxContext = svelteRedux.reduxContext.filter((existingStore) => {
      return existingStore !== store;
    });
  }
};

/*
  Store debugging tools.
  We add a list of stores for case when there are multiple stores initialized.
  We don't want to initialize multiple stores, and should see that immediately.
*/
export const registerGlobalDevTools = (store: GlobalDevToolsStore): (() => void) => {
  const svelteRedux = getOrCreateSvelteReduxGlobal();
  if (!svelteRedux) {
    return () => {};
  }

  if (!svelteRedux.reduxContext) {
    svelteRedux.reduxContext = store;
  } else if (svelteRedux.reduxContext !== store) {
    const list: GlobalDevToolsStore[] = [];
    svelteRedux.reduxContext = list.concat(svelteRedux.reduxContext).concat(store);
    console.error("Multiple Redux stores initialized:", svelteRedux.reduxContext);
  }

  return () => cleanUpGlobalDevTools(store);
};