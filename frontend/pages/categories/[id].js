// frontend/pages/categories/[id].js
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Layout from "../../components/Layout";
import FilterSort from "../../components/FilterSort";
import ProductTable from "../../components/ProductTable";

export default function CategoryDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [category, setCategory]       = useState(null);
  const [subcategories, setSubs]      = useState([]);
  const [products, setProducts]       = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingProds, setLoadingProds]= useState(true);

  // фильтры
  const [sort, setSort]       = useState("default");
  const [search, setSearch]   = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");

  // 1) Подгружаем саму категорию + метрики + подкатегории
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingCats(true);
      try {
        const [catRes, subRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories/${id}`),
          fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories?parentId=${id}`)
        ]);
        const catData = await catRes.json();
        const subData = await subRes.json();
        setCategory(catData.category);
        setSubs(subData.categories || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingCats(false);
      }
    })();
  }, [id]);

  // 2) Подгружаем товары при изменении фильтров
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingProds(true);
      try {
        const params = new URLSearchParams();
        params.append("categoryId", id);
        if (sort)     params.append("sort", sort);
        if (search)   params.append("search", search);
        if (dateFrom) params.append("dateFrom", dateFrom);
        if (dateTo)   params.append("dateTo", dateTo);

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/products?${params.toString()}`
        );
        const data = await res.json();
        setProducts(Array.isArray(data.products) ? data.products : []);
      } catch (err) {
        console.error(err);
        setProducts([]);
      } finally {
        setLoadingProds(false);
      }
    })();
  }, [id, sort, search, dateFrom, dateTo]);

  if (loadingCats) return <Layout><p>Загрузка категории…</p></Layout>;
  if (!category)  return <Layout><p>Категория не найдена.</p></Layout>;

  return (
    <Layout>
      <div className="mb-4">
        <button
          onClick={() => router.push("/categories")}
          className="text-blue-600 hover:underline"
        >
          ← Вернуться к списку категорий
        </button>
      </div>

      <h2 className="text-xl font-bold mb-4">{category.name}</h2>
      <div className="mb-6 flex flex-wrap gap-6">
        <div>Товаров: {category.products_count}</div>
        <div>Продажи: {category.sales.toLocaleString()} шт.</div>
        <div>Выручка: {category.revenue.toLocaleString()} ₸</div>
      </div>

      {/* --- Выбор периода --- */}
      <div className="mb-6 flex gap-4">
        <div>
          <label className="block text-sm mb-1">С</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border px-2 py-1 rounded"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">По</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border px-2 py-1 rounded"
          />
        </div>
      </div>

      {/* --- Сортировка и поиск --- */}
      <FilterSort onFilterSort={(newSort, newSearch) => {
        setSort(newSort);
        setSearch(newSearch);
      }} />

      {subcategories.length > 0 ? (
        // если есть подкатегории — показываем список (можно расчёркивать дальше)
        <ul className="list-disc pl-6">
          {subcategories.map(sc => (
            <li key={sc.id} className="mb-1">
              <Link href={`/categories/${sc.id}`}>
                <a className="text-blue-600 underline">{sc.name}</a>
              </Link>
              {' — '}
              {sc.sales.toLocaleString()} / {sc.revenue.toLocaleString()} ₸
            </li>
          ))}
        </ul>
      ) : (
        // если нет детей — показываем таблицу товаров
        loadingProds ? (
          <p>Загрузка товаров…</p>
        ) : (
          <ProductTable products={products} />
        )
      )}
    </Layout>
  );
}
