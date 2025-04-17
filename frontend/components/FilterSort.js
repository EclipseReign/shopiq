// frontend/components/FilterSort.js
import { useState } from "react";

export default function FilterSort({ onFilterSort }) {
  // Опции сортировки
  const sortOptions = [
    { label: "По умолчанию", value: "default" },
    { label: "Цена ↑", value: "price-asc" },
    { label: "Цена ↓", value: "price-desc" },
    { label: "Рейтинг", value: "rating" },
+   { label: "Выручка ↑", value: "revenue-asc" },
+   { label: "Выручка ↓", value: "revenue-desc" },
  ];

  const [selectedSort, setSelectedSort] = useState("default");
  const [searchTerm, setSearchTerm]   = useState("");

  const handleSortChange = (e) => {
    const newSort = e.target.value;
    setSelectedSort(newSort);
    onFilterSort(newSort, searchTerm);
  };

  const handleSearchChange = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    onFilterSort(selectedSort, term);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-4 rounded-lg shadow-md">
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">Сортировка</label>
        <select
          value={selectedSort}
          onChange={handleSortChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          {sortOptions.map((opt, i) => (
            <option key={i} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">Поиск</label>
        <input
          type="text"
          value={searchTerm}
          onChange={handleSearchChange}
          placeholder="Введите название товара..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        />
      </div>
    </div>
  );
}
