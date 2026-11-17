import { useEffect, useState } from "react";

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Не удалось загрузить данные");
  return data;
}

export function useResource(path, refresh = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "" });
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: error.message });
      });
    return () => controller.abort();
  }, [path, refresh]);
  return state;
}

const numberFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
const moneyFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
export const number = (value) =>
  value == null ? "—" : numberFormat.format(Number(value));
export const money = (value) =>
  value == null ? "—" : `${moneyFormat.format(Number(value))} ₸`;
export const rating = (value) =>
  value == null ? "—" : Number(value).toFixed(1);
export function dateTime(value) {
  if (!value) return "Обновлений пока нет";
  const date = new Date(
    value.endsWith("Z") || value.includes("+")
      ? value
      : `${value.replace(" ", "T")}Z`,
  );
  return Number.isNaN(date.getTime())
    ? "Дата неизвестна"
    : new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Almaty",
      }).format(date);
}
