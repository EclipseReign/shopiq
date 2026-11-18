import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { useAuth } from "../lib/auth";

export default function Login() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(
    params.get("reset") === "1" ? "password" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let result;
      if (mode === "signup")
        result = await auth.client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/login` },
        });
      else if (mode === "reset")
        result = await auth.client.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/login?reset=1`,
        });
      else if (mode === "password")
        result = await auth.client.auth.updateUser({ password });
      else
        result = await auth.client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setPassword("");
      setMessage(
        mode === "signup"
          ? "Проверьте почту и подтвердите регистрацию."
          : mode === "reset"
            ? "Если аккаунт существует, на почту придёт ссылка для смены пароля."
            : mode === "password"
              ? "Пароль обновлён."
              : "Вход выполнен.",
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Layout title="Аккаунт">
      <div className="page-heading">
        <div>
          <h1>
            {auth.user
              ? "Ваш аккаунт"
              : mode === "signup"
                ? "Создать аккаунт"
                : "Вход в ShopIQ"}
            <span className="accent">.</span>
          </h1>
          <p>
            Магазины, правила цен и история изменений в личном рабочем
            пространстве.
          </p>
        </div>
      </div>
      <section className="panel auth-panel">
        {auth.loading ? (
          <p role="status">Подключаем аккаунт…</p>
        ) : auth.error ? (
          <p role="alert" className="error">
            {auth.error}
          </p>
        ) : !auth.config?.cloud ? (
          <p>Личный кабинет доступен в облачной версии ShopIQ.</p>
        ) : auth.user && mode !== "password" ? (
          <div className="stack">
            <h2>{auth.user.email}</h2>
            <Link to="/stores" className="button primary">
              Перейти к магазинам →
            </Link>
            <button
              className="text-button"
              onClick={() => auth.client.auth.signOut()}
            >
              Выйти из аккаунта
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <h2>
              {mode === "signup"
                ? "Регистрация"
                : mode === "reset"
                  ? "Восстановление доступа"
                  : mode === "password"
                    ? "Новый пароль"
                    : "Войти в аккаунт"}
            </h2>
            {mode !== "password" && (
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                Пароль
                <input
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "login" ? 1 : 12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode !== "login" && <small>Минимум 12 символов.</small>}
              </label>
            )}
            {mode === "password" && !auth.user ? (
              <p>Откройте ссылку из письма для восстановления пароля.</p>
            ) : (
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Подождите…"
                  : mode === "signup"
                    ? "Зарегистрироваться"
                    : mode === "reset"
                      ? "Получить ссылку"
                      : mode === "password"
                        ? "Сохранить пароль"
                        : "Войти"}
              </button>
            )}
            <div className="form-actions">
              {mode !== "signup" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMode("signup");
                    setMessage("");
                    setError("");
                  }}
                >
                  Регистрация
                </button>
              )}
              {mode !== "login" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setMode("login");
                    setMessage("");
                    setError("");
                  }}
                >
                  Уже есть аккаунт
                </button>
              )}
              {mode === "login" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setMode("reset")}
                >
                  Забыли пароль
                </button>
              )}
            </div>
          </form>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Layout>
  );
}
