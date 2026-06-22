export function componentImportMessage(sourcePath) {
  if (sourcePath === "typed-redux-saga" || sourcePath === "redux-saga" || sourcePath.startsWith("redux-saga/")) {
    return "Components must not import saga effect libraries; dispatch actions or read selectors instead.";
  }
  if (/(^|\/)sagas?\//.test(sourcePath) || /(^|\/)[^/]*-saga(?:\.[cm]?[jt]sx?)?$/.test(sourcePath)) {
    return "Components must not import saga source; dispatch actions instead.";
  }
  if (/(?:(?:^|\/)(?:collection-utils|create-reducer)(?:$|\.)|(?:^|\/)redux-dispatch-bridge(?:$|\/))/.test(sourcePath)) {
    return "Components must not import collection, reducer, or removed bridge internals.";
  }
  return undefined;
}

