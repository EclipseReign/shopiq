import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useResource, dateTime, number } from "../lib/api";
import Metrics from "./Metrics";
import ProductTable from "./ProductTable";
import FilterSort from "./FilterSort";
import Status from "./Status";

const initialFilters = {
  search: "",
  sort: "default",
  dateFrom: "",
  dateTo: "",
  cityId: "",
};

export default function Catalog({ categoryId }) {
  const [filters, setFilters] = useState(initialFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState("");
  const categories = useResource(categoryId ? null : "/categories");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);
  useEffect(() => {
    setPage(1);
  }, [categoryId]);
  const category = categoryId || selectedCategory;
  const params = new URLSearchParams({
    sort: filters.sort,
    search: debouncedSearch,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    cityId: filters.cityId,
  });
  if (category) params.set("categoryId", category);
  const query = params.toString();
  const products = useResource(`/products?${query}&page=${page}`);
  const overview = useResource(`/overview?${query}`);
  function change(name, value) {
    setFilters((previous) => ({ ...previous, [name]: value }));
    setPage(1);
  }
  function reset() {
    setFilters(initialFilters);
    setSelectedCategory("");
    setPage(1);
  }
  const pagination = products.data?.pagination;
  return (
    <>
      <Metrics overview={overview.data?.overview} />
      {overview.error && (
        <p className="notice error" role="alert">
          {overview.error}
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Каталог товаров</h2>
            <p>Цены и показатели последних сохранённых карточек</p>
          </div>
          {!categoryId && (
            <label className="category-select">
              <span className="sr-only">Категория товаров</span>
              <select
                aria-label="Категория товаров"
                value={selectedCategory}
                onChange={(event) => {
                  setSelectedCategory(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Все категории</option>
                {categories.data?.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <FilterSort filters={filters} onChange={change} onReset={reset} />
        <Status
          loading={products.loading}
          error={products.error}
          empty={!products.data?.products.length}
        >
          <ProductTable products={products.data?.products || []} />
        </Status>
        {pagination && pagination.total > 0 && (
          <div className="pagination">
            <span>
              Показано {number((page - 1) * pagination.pageSize + 1)}–
              {number(Math.min(page * pagination.pageSize, pagination.total))}{" "}
              из {number(pagination.total)}
            </span>
            <div>
              <button
                aria-label="Предыдущая страница"
                className="page-button"
                disabled={page <= 1 || products.loading}
                onClick={() => setPage((value) => value - 1)}
              >
                ←
              </button>
              <span>
                Страница {number(page)} из {number(pagination.pages)}
              </span>
              <button
                aria-label="Следующая страница"
                className="page-button"
                disabled={page >= pagination.pages || products.loading}
                onClick={() => setPage((value) => value + 1)}
              >
                →
              </button>
            </div>
          </div>
        )}
      </section>
      <div className="data-note">
        <span aria-hidden="true">ⓘ</span>
        <p>
          Период фильтрует дату последнего сбора карточки. Последняя карточка
          обновлена {dateTime(overview.data?.overview.last_updated)}.{" "}
          <Link to="/scraper">Обновить данные ↗</Link>
        </p>
      </div>
    </>
  );
}
