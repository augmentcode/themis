import { useEffect } from "react";
import { getDispatch, getReduxStore } from "../redux/store";

export function TodosPanel() {
  useEffect(() => {
    const dispatch = getDispatch();
    dispatch({ type: "todos/load" });
  }, []);

  const startPolling = () => {
    setInterval(() => {
      getReduxStore().dispatch({ type: "todos/poll" });
    }, 1000);
  };

  return <button onClick={startPolling}>Poll</button>;
}

