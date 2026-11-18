import { useEffect, useState } from "react";
let accessToken = "";
export function setAccessToken(token) {
  accessToken = token;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (accessToken && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`/api${path}`, { ...options, headers });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Сервис вернул неожиданный ответ. Повторите запрос.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Не удалось загрузить данные"),
      { status: response.status, data },
    );
  return data;
}

export function useResource(path, refresh = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    if (!path) { setState({data:null,loading:false,error:''});return; }
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
