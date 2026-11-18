import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { api, useResource, dateTime, number } from "../lib/api";
import { cities } from "../lib/cities";
import { useAuth } from "../lib/auth";

const states = {
  running: "Сбор выполняется",
  cancelling: "Завершаем сбор",
  completed: "Сбор завершён",
  failed: "Сбор завершился с ошибкой",
  cancelled: "Сбор остановлен",
  interrupted: "Сбор прерван перезапуском",
  partial: "Сбор завершён с расхождениями",
};

export default function Scraper() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const requestedCategory = searchParams.get("categoryId");
  const categories = useResource("/categories");
  const [categoryId, setCategoryId] = useState("");
  const [maxPages, setMaxPages] = useState(3);
  const [full, setFull] = useState(false);
  const [workers, setWorkers] = useState(1);
  const [cityId, setCityId] = useState("750000000");
  const [token, setToken] = useState("");
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const active = ["running", "cancelling"].includes(run?.status);
  const selected = useResource(
    categoryId && categoryId !== "all"
      ? `/categories/${encodeURIComponent(categoryId)}`
      : null,
  );
  useEffect(() => {
    setCategoryId(requestedCategory || "");
  }, [requestedCategory]);
  useEffect(() => {
    let mounted = true;
    let timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const data = await api("/scrape/status", { signal: controller.signal });
        if (mounted) {
          setRun(data.run);
          setStatusError("");
        }
      } catch (error) {
        if (mounted && !controller.signal.aborted)
          setStatusError(error.message);
      }
      if (mounted) timer = setTimeout(poll, active ? 2500 : 15000);
    }
    poll();
    return () => {
      mounted = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active]);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api("/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          categoryId: categoryId === "all" ? undefined : categoryId,
          maxPages,
          workers,
          cityId,
          full,
        }),
      });
      setRun(data.run);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const data = await api("/scrape/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      setRun(data.run);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Layout title="Сбор данных">
      <div className="page-heading">
        <div>
          <h1>
            Сбор данных<span className="accent">.</span>
          </h1>
          <p>Выберите категорию, город и объём сбора.</p>
        </div>
      </div>
      <div className="scraper-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Параметры сбора</h2>
              <p>Повторный запуск обновляет существующие карточки</p>
            </div>
          </div>
          <form className="scraper-form" onSubmit={submit}>
            <label>
              Категория
              <select
                required
                value={categoryId}
                disabled={active || busy}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="" disabled>
                  Выберите категорию
                </option>
                <option value="all">Весь каталог</option>
                {categoryId &&
                  categoryId !== "all" &&
                  !categories.data?.categories.some(
                    (item) => String(item.id) === categoryId,
                  ) && (
                    <option value={categoryId}>
                      {selected.data?.category.name ||
                        `Категория ${categoryId}`}
                    </option>
                  )}
                {categories.data?.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {categories.error && (
              <p className="error" role="alert">
                {categories.error}
              </p>
            )}
            {selected.error && (
              <p className="error" role="alert">
                {selected.error}
              </p>
            )}
            <label>
              Город
              <select
                value={cityId}
                disabled={active || busy}
                onChange={(event) => setCityId(event.target.value)}
              >
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-columns">
              <label>
                Страниц на категорию
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  disabled={active || busy || full}
                  value={maxPages}
                  onChange={(event) => setMaxPages(event.target.value)}
                />
              </label>
              {!auth.config?.cloud && (
                <label>
                  Параллельных запросов
                  <input
                    type="number"
                    min="1"
                    max="4"
                    required
                    disabled={active || busy}
                    value={workers}
                    onChange={(event) => setWorkers(event.target.value)}
                  />
                </label>
              )}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={full}
                onChange={(event) => setFull(event.target.checked)}
                disabled={active || busy}
              />
              Пройти все страницы выбранных категорий
            </label>
            <p className="field-help">
              Сбор обрабатывает конечные категории раздела. Полный каталог
              содержит миллионы позиций. Прогресс и расхождения доступны на
              странице полноты данных.
            </p>
            {!auth.config?.cloud && (
              <details>
                <summary>Доступ к удалённому серверу</summary>
                <label>
                  Токен управления
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="SCRAPER_TOKEN"
                  />
                </label>
              </details>
            )}
            {auth.config?.cloud && !auth.admin && (
              <p className="field-help">
                Общим сбором управляет администратор. Сравнение конкурентов
                доступно в разделе «Конкуренты».
              </p>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={
                Boolean(active) ||
                busy ||
                Boolean(statusError) ||
                Boolean(auth.config?.cloud && !auth.admin)
              }
            >
              ↻{" "}
              {active
                ? "Сбор выполняется"
                : busy
                  ? "Запускаем…"
                  : "Начать сбор"}
            </button>
          </form>
        </section>
        <section className="panel run-panel">
          <div className="panel-heading">
            <div>
              <h2>Ход выполнения</h2>
              <p>Результаты сохраняются после каждой страницы</p>
            </div>
            <span className={`run-indicator ${active ? "running" : ""}`} />
          </div>
          {statusError && (
            <p className="notice error" role="alert">
              {statusError}
            </p>
          )}
          {run ? (
            <div className="run-body" aria-live="polite">
              <div className={`run-state ${run.status}`}>
                <span>{states[run.status]}</span>
                {active && <span className="spinner" />}
              </div>
              <p className="muted">Запущен {dateTime(run.started_at)}</p>
              <div className="run-metrics">
                <div>
                  <strong>{number(run.progress?.saved || 0)}</strong>
                  <span>Карточек обработано</span>
                </div>
                <div>
                  <strong>{number(run.progress?.pages || 0)}</strong>
                  <span>Страниц сохранено</span>
                </div>
              </div>
              <p className="muted">
                Категорий завершено{" "}
                {number(run.progress?.completedCategories || 0)} /{" "}
                {number(run.progress?.totalCategories)}
              </p>
              {run.error && <p className="notice error">{run.error}</p>}
              <div className="run-events">
                {run.progress?.events
                  ?.filter(
                    (event) =>
                      event.type === "page" ||
                      event.type === "warning" ||
                      event.type === "error",
                  )
                  .slice(-5)
                  .map((event, index) => (
                    <p key={index}>
                      {event.type === "page"
                        ? `Категория ${event.category_id} · страница ${event.page} · ${event.saved} карточек`
                        : event.message}
                    </p>
                  ))}
              </div>
              {active && (
                <button
                  className="button secondary"
                  disabled={busy || run.status === "cancelling"}
                  onClick={cancel}
                >
                  {run.status === "cancelling"
                    ? "Завершаем запросы…"
                    : "Остановить сбор"}
                </button>
              )}
              {run.finished_at && (
                <p className="muted">Завершён {dateTime(run.finished_at)}</p>
              )}
            </div>
          ) : (
            <div className="state-panel">
              <span className="empty-icon" aria-hidden="true">
                ↻
              </span>
              <strong>Готовы к обновлению</strong>
              <p>Здесь появятся прогресс и результат запуска.</p>
            </div>
          )}
        </section>
      </div>
      <div className="data-note">
        <span aria-hidden="true">ⓘ</span>
        <p>
          Цены и история сохраняются отдельно по городам. Фильтр города в
          каталоге показывает соответствующие наблюдения. Для недоступных
          карточек сохраняется прежняя дата сбора.
        </p>
      </div>
    </Layout>
  );
}
