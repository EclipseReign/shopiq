import { cities } from "../lib/cities";
export default function FilterSort({ filters, onChange, onReset }) {
  return (
    <div className="filters">
      <label className="search-field">
        <span className="sr-only">Поиск товаров</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Название товара или бренд"
          maxLength={200}
          value={filters.search}
          onChange={(event) => onChange("search", event.target.value)}
        />
      </label>
      <label>
        <span>Сортировка</span>
        <select
          value={filters.sort}
          onChange={(event) => onChange("sort", event.target.value)}
        >
          <option value="default">Сначала обновлённые</option>
          <option value="price-asc">Сначала дешевле</option>
          <option value="price-desc">Сначала дороже</option>
          <option value="rating">По рейтингу</option>
          <option value="reviews">По отзывам</option>
        </select>
      </label>
      <label>
        <span>Город наблюдения</span>
        <select
          value={filters.cityId}
          onChange={(event) => onChange("cityId", event.target.value)}
        >
          <option value="">Все города</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Обновлены с</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(event) => onChange("dateFrom", event.target.value)}
        />
      </label>
      <label>
        <span>Обновлены по</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(event) => onChange("dateTo", event.target.value)}
        />
      </label>
      <button className="reset-button" onClick={onReset}>
        Сбросить
      </button>
    </div>
  );
}
