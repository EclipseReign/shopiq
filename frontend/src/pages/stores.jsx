import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import Status from "../components/Status";
import { useAuth } from "../lib/auth";
import { api, useResource, dateTime } from "../lib/api";
import { cities } from "../lib/cities";

export default function Stores() {
  const auth = useAuth();
  const navigate = useNavigate();
  const resource = useResource(auth.user ? "/stores" : null,auth.user?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const { store } = await api("/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      navigate(`/stores/${store.id}`);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Layout title="Мои магазины">
      <div className="page-heading">
        <div>
          <h1>
            Мои магазины<span className="accent">.</span>
          </h1>
          <p>Ассортимент, конкуренты и управление ценами вашего бизнеса.</p>
        </div>
      </div>
      {auth.loading ? (
        <p role="status">Загружаем аккаунт…</p>
      ) : !auth.user ? (
        <section className="panel auth-panel stack">
          <h2>Подключите свой магазин Kaspi</h2>
          <p>
            Войдите, импортируйте полный XML-прайс и задайте правила цен для
            своих товаров.
          </p>
          <Link className="button primary" to="/login">
            Войти в аккаунт →
          </Link>
        </section>
      ) : (
        <div className="store-layout">
          <section>
            <Status
              loading={resource.loading}
              error={resource.error}
              empty={false}
            >
              <div className="store-cards">
                {resource.data?.stores.length ? (
                  resource.data.stores.map((store) => (
                    <Link
                      to={`/stores/${store.id}`}
                      key={store.id}
                      className="panel store-card"
                    >
                      <span className="store-icon">▣</span>
                      <div>
                        <h2>{store.name}</h2>
                        <p>ID {store.merchant_id}</p>
                        <small>Добавлен {dateTime(store.created_at)}</small>
                      </div>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))
                ) : (
                  <div className="panel state-panel">
                    <h2>Добавьте первый магазин</h2>
                    <p>ID магазина находится в кабинете продавца Kaspi.</p>
                  </div>
                )}
              </div>
            </Status>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Подключить магазин</h2>
            </div>
            <form className="scraper-form" onSubmit={create}>
              <label>
                Название
                <input
                  name="name"
                  maxLength={120}
                  required
                  placeholder="Название вашего магазина"
                />
              </label>
              <label>
                ID магазина Kaspi
                <input
                  name="merchantId"
                  maxLength={100}
                  required
                  autoComplete="off"
                />
                <small>Укажите merchantid из своего XML-прайса.</small>
              </label>
              <label>
                Город для сравнения цен
                <select name="cityId" defaultValue="750000000">
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </label>
              {error && (
                <p className="error notice" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Добавляем…" : "Добавить магазин"}
              </button>
            </form>
          </section>
        </div>
      )}
    </Layout>
  );
}
