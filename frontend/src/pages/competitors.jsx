import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Layout from "../components/Layout";
import { api, money, number, rating, dateTime } from "../lib/api";
import { cities } from "../lib/cities";

function productId(value) {
  const text = value.trim();
  if (/^\d{1,20}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname === "kaspi.kz" && url.protocol === "https:")
      return url.pathname.match(/(?:-|\/p\/)(\d{1,20})\/?$/)?.[1];
  } catch {}
  return null;
}

export default function Competitors() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(params.get("id") || "");
  const [cityId, setCityId] = useState("750000000");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const id = productId(input);
    setError("");
    setResult(null);
    if (!id) {
      setError("Вставьте ссылку на карточку Kaspi или её числовой ID.");
      return;
    }
    setBusy(true);
    try {
      setResult(await api(`/offers/${id}?cityId=${cityId}`));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    setError("");
    try {
      const next = await api(
        `/offers/${result.external_id}?cityId=${result.city_id}&page=${result.page + 1}&pageSize=${result.pageSize}`,
      );
      setResult((previous) => ({
        ...next,
        offers: [
          ...new Map(
            [...previous.offers, ...next.offers].map((offer) => [
              `${offer.merchant_id}\0${offer.merchant_sku}`,
              offer,
            ]),
          ).values(),
        ].sort((a, b) => a.price - b.price),
      }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Layout title="Конкуренты">
      <div className="page-heading">
        <div>
          <h1>
            Цены конкурентов<span className="accent">.</span>
          </h1>
          <p>Актуальные предложения продавцов по любой карточке Kaspi.</p>
        </div>
        <Link className="button secondary" to="/stores">
          Настроить свои цены ↗
        </Link>
      </div>
      <section className="panel">
        <form className="lookup-form" onSubmit={submit}>
          <label>
            Ссылка или ID товара
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              required
              maxLength={1000}
              placeholder="Ссылка на товар в Kaspi"
            />
          </label>
          <label>
            Город
            <select value={cityId} onChange={(e) => setCityId(e.target.value)}>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Проверяем…" : "Найти предложения"}
          </button>
        </form>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {result ? (
          <>
            <div className="panel-heading">
              <div>
                <h2>{number(result.total)} предложений в городе</h2>
                <p>Проверено {dateTime(result.observed_at)}</p>
              </div>
              {result.offers.length > 0 && (
                <strong className="market-min">
                  от {money(result.offers[0].price)}
                </strong>
              )}
            </div>
            {result.offers.length ? (
              <div className="table-scroll">
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Продавец</th>
                      <th>Цена</th>
                      <th>Рейтинг</th>
                      <th>Отзывы о продавце</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.offers.map((offer, index) => (
                      <tr key={`${offer.merchant_id}-${index}`}>
                        <td>
                          <strong>{offer.merchant_name}</strong>
                          <small>{offer.merchant_id}</small>
                        </td>
                        <td className="price-value">{money(offer.price)}</td>
                        <td>{rating(offer.rating)}</td>
                        <td>{number(offer.reviews)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="state-panel">
                <h2>Доступных предложений нет</h2>
                <p>Проверьте город или повторите позже.</p>
              </div>
            )}
            {result.offers.length < result.total && (
              <p className="data-caption">
                Показаны {number(result.offers.length)} самых доступных
                предложений из {number(result.total)}.
              </p>
            )}
            {result.hasMore && (
              <div className="pagination">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={more}
                >
                  {busy ? "Загружаем…" : "Показать следующих продавцов"}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="state-panel">
            <span className="empty-icon" aria-hidden="true">
              ⇄
            </span>
            <h2>
              {busy
                ? "Загружаем предложения…"
                : "Проверьте товар перед изменением цены"}
            </h2>
            <p>Скопируйте ссылку из карточки Kaspi и выберите город.</p>
          </div>
        )}
      </section>
    </Layout>
  );
}
