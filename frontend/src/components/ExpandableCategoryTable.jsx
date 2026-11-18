import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource, money, number } from "../lib/api";
import Status from "./Status";

function CategoryRow({ category, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const children = useResource(
    open ? `/categories?parentId=${category.id}` : null,
  );
  return (
    <>
      <tr>
        <td>
          <div className="category-cell" style={{ paddingLeft: depth * 22 }}>
            {category.has_children ? (
              <button
                className="tree-toggle"
                aria-label={`${open ? "Свернуть" : "Раскрыть"} ${category.name}`}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                {open ? "⌄" : "›"}
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <Link to={`/categories/${category.id}`}>{category.name}</Link>
            {category.source_active === 0 && (
              <small className="archive-label">Архив</small>
            )}
          </div>
        </td>
        <td className="numeric">{number(category.products_count)}</td>
        <td className="numeric">{money(category.average_price)}</td>
        <td className="numeric">{number(category.reviews_count)}</td>
        <td className="row-action">
          <Link
            aria-label={`Открыть ${category.name}`}
            to={`/categories/${category.id}`}
          >
            ↗
          </Link>
        </td>
      </tr>
      {open && children.loading && (
        <tr>
          <td colSpan={5} className="nested-message" role="status">
            Загружаем подкатегории…
          </td>
        </tr>
      )}
      {open && children.error && (
        <tr>
          <td colSpan={5} className="error" role="alert">
            {children.error}
          </td>
        </tr>
      )}
      {open &&
        children.data?.categories.map((child) => (
          <CategoryRow key={child.id} category={child} depth={depth + 1} />
        ))}
    </>
  );
}

export default function ExpandableCategoryTable({
  categories,
  loading,
  error,
}) {
  return (
    <Status loading={loading} error={error} empty={!categories?.length}>
      <div className="table-scroll">
        <table className="category-table">
          <thead>
            <tr>
              <th>Категория</th>
              <th className="numeric">Товары</th>
              <th className="numeric">Средняя цена</th>
              <th className="numeric">Отзывы</th>
              <th aria-label="Открыть" />
            </tr>
          </thead>
          <tbody>
            {categories?.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </tbody>
        </table>
      </div>
    </Status>
  );
}
