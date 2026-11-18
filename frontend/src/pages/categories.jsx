import { useState } from "react";
import Layout from "../components/Layout";
import ExpandableCategoryTable from "../components/ExpandableCategoryTable";
import { useResource, number } from "../lib/api";

export default function Categories() {
  const { data, loading, error } = useResource("/categories");
  const [search, setSearch] = useState("");
  const categories =
    data?.categories.filter((category) =>
      category.name.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <Layout title="Категории">
      <div className="page-heading">
        <div>
          <h1>
            Категории Kaspi<span className="accent">.</span>
          </h1>
          <p>От общего рынка к конкретной нише, шаг за шагом.</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Все разделы</h2>
            <p>Метрики включают товары вложенных категорий</p>
          </div>
          <span className="count-label">
            {number(categories.length)} разделов
          </span>
        </div>
        <div className="category-search">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Поиск раздела"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Найти раздел каталога"
            />
          </label>
        </div>
        <ExpandableCategoryTable
          categories={categories}
          loading={loading}
          error={error}
        />
      </section>
    </Layout>
  );
}
