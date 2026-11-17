import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";

const navigation = [
  { href: "/", label: "Обзор", icon: "◫" },
  { href: "/categories", label: "Категории", icon: "▦" },
  { href: "/dashboard", label: "Товары", icon: "▤" },
  { href: "/scraper", label: "Сбор данных", icon: "↻" },
];

export default function Layout({ children, title = "Обзор" }) {
  const router = useRouter();
  return (
    <div className="app-shell">
      <Head>
        <title>{`${title} · ShopIQ`}</title>
        <meta
          name="description"
          content="ShopIQ — каталог и аналитика товаров Kaspi"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <a className="skip-link" href="#content">
        К содержимому
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="ShopIQ, главная">
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
                href={item.href}
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
          <span className="workspace-label">Kaspi · Казахстан</span>
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
