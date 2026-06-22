import { useEffect } from "react";
import { getDispatch } from "../redux/store";

export function TodosPanel() {
  const dispatch = getDispatch();

  useEffect(() => {
    dispatch({ type: "todos/load" });
  }, [dispatch]);

  return <p>Todos</p>;
}

