import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "../../components/Layout";
import Catalog from "../../components/Catalog";
import Status from "../../components/Status";
import { useResource } from "../../lib/api";

export default function CategoryDetail() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const category = useResource(
    id ? `/categories/${encodeURIComponent(id)}` : null,
  );
  const children = useResource(
    id ? `/categories?parentId=${encodeURIComponent(id)}` : null,
  );
  return (
    <Layout title="Категории">
      <Link className="back-link" href="/categories">
        ← Все категории
      </Link>
      <Status loading={category.loading} error={category.error}>
        <div className="page-heading">
          <div>
            <div className="eyebrow">КАТЕГОРИЯ КАТАЛОГА</div>
            <h1>
              {category.data?.category.name}
              <span className="accent">.</span>
            </h1>
            <p>Товары этого раздела и всех его подкатегорий.</p>
          </div>
          {category.data?.category.can_scrape && (
            <Link className="button primary" href={`/scraper?categoryId=${id}`}>
              <span aria-hidden="true">↻</span> Обновить категорию
            </Link>
          )}
        </div>
        {category.data && !category.data.category.can_scrape && (
          <p className="data-note">
            Архивная категория. Для обновления выберите соответствующий раздел
            текущего каталога Kaspi.
          </p>
        )}
        {children.error && (
          <p role="alert" className="notice error">
            {children.error}
          </p>
        )}
        {children.data?.categories.length > 0 && (
          <nav className="subcategory-links" aria-label="Подкатегории">
            {children.data.categories.map((child) => (
              <Link key={child.id} href={`/categories/${child.id}`}>
                {child.name} <span>↗</span>
              </Link>
            ))}
          </nav>
        )}
        {id && <Catalog key={id} categoryId={id} />}
      </Status>
    </Layout>
  );
}
