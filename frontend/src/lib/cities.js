export const cities = [
  { id: "750000000", name: "Алматы" },
  { id: "710000000", name: "Астана" },
  { id: "790000000", name: "Шымкент" },
  { id: "431010000", name: "Кызылорда" },
];

export function cityName(id) {
  if (!id) return "Город не указан";
  return cities.find((city) => city.id === id)?.name || `Город ${id}`;
}
