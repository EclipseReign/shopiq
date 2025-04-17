import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import FilterSort from "../components/FilterSort";
import ProductTable from "../components/ProductTable";
import CategoryTree from "../components/CategoryTree";

export default function Dashboard() {
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [products, setProducts] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingProds, setLoadingProds] = useState(true);
  const [sort, setSort] = useState("default");
  const [search, setSearch] = useState("");

  // 1) Подгрузка списка корневых категорий
  useEffect(() => {
    (async () => {
      setLoadingCats(true);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/categories`
        );
        const data = await res.json();
        setCategories(data.categories || []);
      } catch (err) {
        console.error("Ошибка загрузки категорий:", err);
        setCategories([]);
      } finally {
        setLoadingCats(false);
      }
    })();
  }, []);

  // 2) Подгрузка товаров при смене фильтров
  useEffect(() => {
    (async () => {
      setLoadingProds(true);
      try {
        const params = new URLSearchParams();
        if (selectedCategoryId) params.append("categoryId", selectedCategoryId);
        if (sort)                 params.append("sort", sort);
        if (search)               params.append("search", search);

        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/products?${params.toString()}`
        );
        const data = await res.json();
        setProducts(Array.isArray(data.products) ? data.products : []);
      } catch (err) {
        console.error("Ошибка загрузки товаров:", err);
        setProducts([]);
      } finally {
        setLoadingProds(false);
      }
    })();
  }, [selectedCategoryId, sort, search]);

  return (
    <Layout>
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-1/4">
          {loadingCats ? (
            <p>Загрузка категорий...</p>
          ) : (
            <CategoryTree
              categories={categories}
              onSelectCategory={setSelectedCategoryId}
            />
          )}
        </div>

        <div className="md:w-3/4">
          <FilterSort onFilterSort={(_, sortOption, searchTerm) => {
            setSort(sortOption);
            setSearch(searchTerm);
          }} />

          {loadingProds ? (
            <div className="text-center py-12">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-500 rounded-full border-t-transparent"></div>
              <p className="mt-4 text-gray-600">Загрузка товаров...</p>
            </div>
          ) : (
            <ProductTable products={products} />
          )}
        </div>
      </div>
    </Layout>
  );
}
