import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

const navigation = [
  { href: "/", label: "Обзор", icon: "◫" },
  { href: "/categories", label: "Категории", icon: "▦" },
  { href: "/dashboard", label: "Товары", icon: "▤" },
  { href: "/competitors", label: "Конкуренты", icon: "⇄" },
  { href: "/stores", label: "Мои магазины", icon: "▣" },
  { href: "/coverage", label: "Полнота данных", icon: "◷" },
  { href: "/scraper", label: "Сбор данных", icon: "↻" },
];

export default function Layout({ children, title = "Обзор" }) {
  const router = useLocation();
  const auth = useAuth();
  useEffect(() => {
    document.title = `${title} · ShopIQ`;
  }, [title]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        К содержимому
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="ShopIQ, главная">
          <span className="brand-mark">
            s<span>i</span>
          </span>
          <span>
            shop<span className="brand-iq">iq</span>
            <small>Аналитика Kaspi</small>
          </span>
        </Link>
        <nav aria-label="Главная навигация">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? router.pathname === "/"
                : router.pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                to={item.href}
                className={`nav-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <span className="source-dot" /> Публичный каталог Kaspi
          <small>Цены и наличие зависят от города.</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Рабочее пространство <span className="topbar-slash">/</span>{" "}
            <strong>{title}</strong>
          </span>
          <div className="account-actions">
            {auth.user ? (
              <>
                <span className="account-email">{auth.user.email}</span>
                <button
                  className="text-button"
                  onClick={() => auth.client.auth.signOut()}
                >
                  Выйти
                </button>
              </>
            ) : (
              <Link to="/login" className="button secondary small">
                Войти
              </Link>
            )}
          </div>
        </header>
        <main id="content">{children}</main>
        <footer className="page-footer">
          <span>ShopIQ · Аналитика каталога</span>
          <span>Время отображается по Казахстану · UTC+5</span>
        </footer>
      </div>
    </div>
  );
}
