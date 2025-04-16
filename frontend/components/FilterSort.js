import { useState } from "react";

export default function FilterSort({ onFilterSort }) {
  const categories = ["Все", "Телефоны и гаджеты", "Аксессуары для телефонов", "Чехлы для телефонов", "Детские товары"];
  
  const sortOptions = [
    { label: "По умолчанию", value: "default" },
    { label: "Цена ↑", value: "price-asc" },
    { label: "Цена ↓", value: "price-desc" },
    { label: "Рейтинг", value: "rating" }
  ];

  const [selectedCategory, setSelectedCategory] = useState("Все");
  const [selectedSort, setSelectedSort] = useState("default");

  const handleCategoryChange = (e) => {
    const newCategory = e.target.value;
    setSelectedCategory(newCategory);
    setSelectedSort("default");
    onFilterSort(newCategory, "default");
  };

  const handleSortChange = (e) => {
    const newSort = e.target.value;
    setSelectedSort(newSort);
    onFilterSort(selectedCategory, newSort);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 mb-8 bg-white p-4 rounded-lg shadow-md">
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">Категория</label>
        <select 
          value={selectedCategory} 
          onChange={handleCategoryChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {categories.map((cat, idx) => (
            <option key={idx} value={cat}>{cat}</option>
          ))}
        </select>
      </div>
      
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-2">Сортировка</label>
        <select 
          value={selectedSort} 
          onChange={handleSortChange}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {sortOptions.map((option, idx) => (
            <option key={idx} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}