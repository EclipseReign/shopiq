import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import Status from "../components/Status";
import { useAuth } from "../lib/auth";
import { api, useResource, money, number, dateTime } from "../lib/api";
import { cityName } from "../lib/cities";

const blankRule = {
  external_id: "",
  min_price: "",
  max_price: "",
  cost: "",
  shipping: "",
  commission_bp: "",
  tax_bp: "",
  margin_bp: "",
  step: 1,
  max_change_bp: 1000,
  auto_enabled: false,
  enabled: true,
};
const ruleFields = [
  ["min_price", "Минимальная цена, ₸"],
  ["max_price", "Максимальная цена, ₸"],
  ["cost", "Себестоимость, ₸"],
  ["shipping", "Дополнительные расходы на заказ, ₸"],
  ["commission_bp", "Комиссия Kaspi, %"],
  ["tax_bp", "Налог от выручки, %"],
  ["margin_bp", "Минимальная маржа от выручки, %"],
  ["step", "Шаг относительно конкурента, ₸"],
  ["max_change_bp", "Максимальное изменение за раз, %"],
];
const changeStates = {
  preview: "Нужно подтверждение",
  blocked: "Приостановлено",
  unchanged: "Цена подходит",
  published: "Опубликовано в XML",
  rejected: "Отклонено",
};

function RuleEditor({ storeId, target, onSaved, onClose }) {
  const [rule, setRule] = useState({ ...blankRule, ...target });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const input = { ...rule };
    for (const [key] of ruleFields) {
      input[key] = key.endsWith("_bp")
        ? Math.round(Number(rule[key]))
        : Number(rule[key]);
    }
    try {
      await api(`/stores/${storeId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      onSaved();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Правило цены · {rule.sku}</h2>
          <p>
            {rule.city_id === "*"
              ? "Общая цена для всех городов"
              : cityName(rule.city_id)}
          </p>
        </div>
        <button className="text-button" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <form className="scraper-form" onSubmit={submit}>
        <label>
          ID карточки товара Kaspi
          <input
            value={rule.external_id}
            onChange={(e) => setRule({ ...rule, external_id: e.target.value })}
            required
            inputMode="numeric"
            pattern="[0-9]{1,20}"
            maxLength={20}
          />
          <small>Проверьте, что карточка точно соответствует этому SKU.</small>
        </label>
        <div className="form-columns">
          {ruleFields.map(([key, label]) => {
            const percentage = key.endsWith("_bp");
            return (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={
                    ["min_price", "max_price", "step"].includes(key)
                      ? 1
                      : key === "max_change_bp"
                        ? 0.01
                        : 0
                  }
                  max={percentage ? 100 : 1000000000000}
                  step={percentage ? "0.01" : "1"}
                  value={
                    rule[key] === ""
                      ? ""
                      : percentage
                        ? rule[key] / 100
                        : rule[key]
                  }
                  onChange={(e) =>
                    setRule({
                      ...rule,
                      [key]:
                        e.target.value === ""
                          ? ""
                          : Number(e.target.value) * (percentage ? 100 : 1),
                    })
                  }
                />
              </label>
            );
          })}
        </div>
        <p className="field-help">
          Минимальная цена учитывает себестоимость, дополнительные расходы,
          комиссию, налог и маржу от выручки. Укажите свои фактические ставки.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
          />
          Правило активно
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={rule.auto_enabled}
            onChange={(e) =>
              setRule({ ...rule, auto_enabled: e.target.checked })
            }
          />
          Автоматически публиковать подходящую цену каждый час
        </label>
        <p className="field-help">
          При выключенном автоматическом режиме каждое изменение нужно
          подтвердить. Общая цена изменится для всех городов, сравнение
          выполняется в городе магазина.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить правило"}
        </button>
      </form>
    </section>
  );
}

export default function Store() {
  const { id } = useParams();
  const auth = useAuth();
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rulesPage, setRulesPage] = useState(1);
  const resource = useResource(
    auth.user
      ? `/stores/${id}?search=${encodeURIComponent(query)}&page=${page}&rulesPage=${rulesPage}`
      : null,
    `${refresh}:${auth.user?.id || ''}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [xml, setXml] = useState(null);
  const [removed, setRemoved] = useState([]);
  const [feedUrl, setFeedUrl] = useState("");
  const [target, setTarget] = useState(null);
  const data = resource.data;
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  async function action(path, input = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api(`/stores/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setRefresh((v) => v + 1);
      return result;
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }
  async function chooseFile(event) {
    setRemoved([]);
    setXml(null);
    setError("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Максимальный размер XML составляет 8 МБ.");
      return;
    }
    setXml(await file.text());
  }
  async function editProduct(product, city) {
    setBusy(true);
    setError("");
    try {
      const { rule } = await api(
        `/stores/${id}/rules?sku=${encodeURIComponent(product.sku)}&city=${encodeURIComponent(city)}`,
      );
      setTarget({ ...blankRule, ...rule, sku: product.sku, city_id: city });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function importFeed(confirmRemoved = []) {
    try {
      const result = await action("import", {
        xml,
        expectedVersion: data.feed?.version || 0,
        confirmRemoved,
      });
      setMessage(
        result.unchanged
          ? "Этот прайс уже импортирован."
          : `Импортирован полный прайс, ${number(result.products)} товаров.`,
      );
      setRemoved([]);
      setXml(null);
    } catch (error) {
      if (error.data?.removed) setRemoved(error.data.removed);
    }
  }
  async function link() {
    try {
      const result = await action("feed-link");
      setFeedUrl(result.url);
    } catch {}
  }
  async function preview(rule) {
    try {
      const result = await action(`rules/${rule.id}/preview`);
      setMessage(result.proposal.details.reason);
    } catch {}
  }
  async function approve(change) {
    try {
      await action(`changes/${change.id}/approve`);
      setMessage(
        "Цена опубликована в полном XML-прайсе. Kaspi загрузит её при следующем обновлении прайса.",
      );
    } catch {}
  }
  return (
    <Layout title={data?.store.name || "Магазин"}>
      <div className="page-heading">
        <div>
          <Link to="/stores" className="back-link">
            ← Мои магазины
          </Link>
          <h1>
            {data?.store.name || "Магазин"}
            <span className="accent">.</span>
          </h1>
          <p>
            {data
              ? `Kaspi ID ${data.store.merchant_id} · Сравнение цен в ${cityName(data.store.city_id)}`
              : "Загружаем рабочее пространство"}
          </p>
        </div>
      </div>
      {!auth.loading && !auth.user ? (
        <section className="panel state-panel">
          <h2>Войдите для доступа к магазину</h2>
          <Link className="button primary" to="/login">
            Войти
          </Link>
        </section>
      ) : (
        <Status
          loading={auth.loading || resource.loading}
          error={resource.error}
          empty={false}
        >
          {data && (
            <>
              <div className="coverage-cards">
                <div className="panel">
                  <span>Товаров в полном прайсе</span>
                  <strong>{number(data.feed?.total || 0)}</strong>
                  <small>
                    {data.feed
                      ? `Версия ${data.feed.version} · ${dateTime(data.feed.updated_at)}`
                      : "Загрузите XML из своей системы учёта"}
                  </small>
                </div>
                <div className="panel">
                  <span>Правил цены</span>
                  <strong>{number(data.rule_pagination.total)}</strong>
                  <small>
                    {number(data.auto_rules)} в автоматическом режиме
                  </small>
                </div>
                <div className="panel">
                  <span>Требуют подтверждения</span>
                  <strong>
                    {number(
                      data.changes.filter(
                        (c) =>
                          c.state === "preview" &&
                          Date.parse(c.expires_at) > Date.now(),
                      ).length,
                    )}
                  </strong>
                  <small>Расчёт действителен 15 минут</small>
                </div>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Подключение прайс-листа</h2>
                    <p>
                      Загрузите исходный полный XML и укажите ссылку ShopIQ в
                      кабинете продавца Kaspi.
                    </p>
                  </div>
                  <a
                    className="text-button"
                    href="https://guide.kaspi.kz/partner/ru/shop/goods/price_list/q3251"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Инструкция Kaspi ↗
                  </a>
                </div>
                <div className="scraper-form">
                  <label>
                    Полный XML-прайс
                    <input
                      type="file"
                      accept=".xml,application/xml,text/xml"
                      onChange={chooseFile}
                      disabled={busy}
                    />
                    <small>
                      До 8 МБ. Новая версия заменяет предыдущий прайс и
                      опубликованные изменения цен.
                    </small>
                  </label>
                  <div className="form-actions">
                    <button
                      className="button primary"
                      disabled={!xml || busy}
                      onClick={() => importFeed()}
                    >
                      Импортировать полный прайс
                    </button>
                    <button
                      className="button secondary"
                      disabled={!data.feed || busy}
                      onClick={link}
                    >
                      Создать новую ссылку для Kaspi
                    </button>
                  </div>
                  {removed.length > 0 && (
                    <div className="notice error">
                      <p>
                        Из прайса исчезнут {number(removed.length)} SKU. Kaspi
                        может снять эти товары с продажи.
                      </p>
                      <details>
                        <summary>Показать удаляемые SKU</summary>
                        <p className="sku-list">{removed.join(", ")}</p>
                      </details>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => importFeed(removed)}
                      >
                        Подтвердить удаление и импорт
                      </button>
                    </div>
                  )}
                  {feedUrl && (
                    <div className="feed-link">
                      <label>
                        Ссылка полного прайса
                        <input
                          readOnly
                          value={feedUrl}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                      <button
                        className="button secondary"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(feedUrl)
                            .then(() => setMessage("Ссылка скопирована."))
                            .catch(() =>
                              setMessage("Выделите и скопируйте ссылку."),
                            )
                        }
                      >
                        Копировать
                      </button>
                      <p>
                        Сохраните ссылку и добавьте её в автоматическую загрузку
                        Kaspi. Ссылка даёт доступ к вашему прайсу. Создание
                        новой ссылки отключает предыдущую.
                      </p>
                    </div>
                  )}
                  <p className="field-help">
                    Kaspi проверяет прайс примерно каждый час. Результат
                    загрузки и ошибки обработки доступны в кабинете продавца.
                  </p>
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Товары магазина</h2>
                    <p>
                      Все SKU исходного XML сохраняются в выгружаемом прайсе.
                    </p>
                  </div>
                  <label>
                    <span className="sr-only">Поиск по ассортименту</span>
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Название или SKU"
                      maxLength={200}
                    />
                  </label>
                </div>
                {data.products.length ? (
                  <>
                    <div className="table-scroll">
                      <table className="merchant-products">
                        <thead>
                          <tr>
                            <th>Товар / SKU</th>
                            <th>Город и текущая цена</th>
                            <th>Управление</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.products.map((product) => (
                            <tr key={product.sku}>
                              <td>
                                <strong>{product.model}</strong>
                                <small>{product.sku}</small>
                              </td>
                              <td>
                                {Object.entries(product.prices).map(
                                  ([city, original]) => (
                                    <div key={city}>
                                      {city === "*"
                                        ? "Все города"
                                        : cityName(city)}{" "}
                                      ·{" "}
                                      {money(
                                        data.feed.overrides[product.sku]?.[
                                          city
                                        ] ?? original,
                                      )}
                                    </div>
                                  ),
                                )}
                              </td>
                              <td>
                                <div className="stack compact">
                                  {Object.keys(product.prices).map((city) => (
                                    <button
                                      key={city}
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() => editProduct(product, city)}
                                    >
                                      {city === "*"
                                        ? "Настроить цену"
                                        : `Правило · ${cityName(city)}`}
                                    </button>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination">
                      <span>{number(data.pagination.total)} товаров</span>
                      <div>
                        <button
                          className="page-button"
                          disabled={page <= 1}
                          onClick={() => setPage((v) => v - 1)}
                          aria-label="Предыдущая страница"
                        >
                          ←
                        </button>
                        <span>
                          {page} / {data.pagination.pages}
                        </span>
                        <button
                          className="page-button"
                          disabled={page >= data.pagination.pages}
                          onClick={() => setPage((v) => v + 1)}
                          aria-label="Следующая страница"
                        >
                          →
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="state-panel">
                    <h2>
                      {data.feed
                        ? "Товары не найдены"
                        : "Импортируйте ассортимент"}
                    </h2>
                    <p>
                      {data.feed
                        ? "Измените поисковый запрос."
                        : "После загрузки XML здесь появятся все товары магазина."}
                    </p>
                  </div>
                )}
              </section>
              {target && (
                <RuleEditor
                  key={`${target.sku}-${target.city_id}-${target.id || "new"}`}
                  storeId={id}
                  target={target}
                  onClose={() => setTarget(null)}
                  onSaved={() => {
                    setTarget(null);
                    setRefresh((v) => v + 1);
                    setMessage("Правило сохранено.");
                  }}
                />
              )}
              {data.rules.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Правила и автоматизация</h2>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Границы цены</th>
                          <th>Режим</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rules.map((rule) => (
                          <tr key={rule.id}>
                            <td>
                              <strong>{rule.sku}</strong>
                              <small>
                                {rule.city_id === "*"
                                  ? "Общая цена"
                                  : cityName(rule.city_id)}{" "}
                                · ID {rule.external_id}
                              </small>
                            </td>
                            <td>
                              {money(rule.min_price)} — {money(rule.max_price)}
                            </td>
                            <td>
                              {!rule.enabled
                                ? "Приостановлено"
                                : rule.auto_enabled
                                  ? "Автоматически каждый час"
                                  : "С подтверждением"}
                            </td>
                            <td>
                              <div className="form-actions">
                                <button
                                  className="text-button"
                                  disabled={busy || !rule.enabled}
                                  onClick={() => preview(rule)}
                                >
                                  Рассчитать
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() => setTarget(rule)}
                                >
                                  Изменить
                                </button>
                                <Link
                                  className="text-button"
                                  to={`/competitors?id=${rule.external_id}`}
                                >
                                  Конкуренты ↗
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {data.rule_pagination.pages > 1 && (
                <div className="pagination">
                  <span>{number(data.rule_pagination.total)} правил</span>
                  <div>
                    <button
                      className="page-button"
                      disabled={rulesPage <= 1}
                      onClick={() => setRulesPage((v) => v - 1)}
                      aria-label="Предыдущие правила"
                    >
                      ←
                    </button>
                    <span>
                      {rulesPage} / {data.rule_pagination.pages}
                    </span>
                    <button
                      className="page-button"
                      disabled={rulesPage >= data.rule_pagination.pages}
                      onClick={() => setRulesPage((v) => v + 1)}
                      aria-label="Следующие правила"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}
              {data.jobs?.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Автоматические проверки</h2>
                  </div>
                  <div className="run-events">
                    {data.jobs.slice(0, 5).map((job) => (
                      <p key={job.id}>
                        <strong>{job.price_rules?.sku}</strong> ·{" "}
                        {dateTime(job.created_at)} ·{" "}
                        {{
                          pending: "В очереди",
                          running: "Выполняется",
                          completed: "Завершено",
                          failed: "Ошибка",
                          skipped: "Приостановлено",
                        }[job.status] || job.status}
                        {job.error && (
                          <span className="error"> — {job.error}</span>
                        )}
                      </p>
                    ))}
                  </div>
                </section>
              )}
              {data.changes.length > 0 && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>История цен</h2>
                      <p>Последние 50 расчётов и публикаций в прайсе</p>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU / расчёт</th>
                          <th>Текущая → новая цена</th>
                          <th>Результат</th>
                          <th>Действие</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.changes.map((change) => {
                          const expired =
                            Date.parse(change.expires_at) <= Date.now();
                          return (
                            <tr key={change.id}>
                              <td>
                                <strong>{change.sku}</strong>
                                <small>{dateTime(change.created_at)}</small>
                              </td>
                              <td>
                                {money(change.current_price)} →{" "}
                                {money(change.suggested_price)}
                                <small>
                                  Минимум с учётом расходов{" "}
                                  {money(change.details.floor)}
                                </small>
                              </td>
                              <td>
                                <span
                                  className={`change-state ${change.state}`}
                                >
                                  {change.state === "preview" && expired
                                    ? "Расчёт устарел"
                                    : changeStates[change.state]}
                                </span>
                                <small>{change.details.reason}</small>
                              </td>
                              <td>
                                {change.state === "preview" && !expired && (
                                  <div className="form-actions">
                                    <button
                                      className="button primary small"
                                      disabled={busy}
                                      onClick={() => approve(change)}
                                    >
                                      Подтвердить
                                    </button>
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() =>
                                        action(
                                          `changes/${change.id}/reject`,
                                        ).catch(() => {})
                                      }
                                    >
                                      Отклонить
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </Status>
      )}
      {(error || message) && (
        <div className="operation-feedback" role={error ? "alert" : "status"}>
          <p className={`notice ${error ? "error" : "success"}`}>
            {error || message}
          </p>
          <button
            className="text-button"
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            Закрыть
          </button>
        </div>
      )}
    </Layout>
  );
}
