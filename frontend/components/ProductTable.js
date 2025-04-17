export default function ProductTable({ products }) {
  return (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="min-w-full table-auto">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2">Изображение</th>
            <th className="px-4 py-2">Название</th>
            <th className="px-4 py-2 text-right">Продажи</th>
            <th className="px-4 py-2 text-right">Цена</th>
            <th className="px-4 py-2 text-right">Рейтинг</th>
            <th className="px-4 py-2 text-right">Выручка</th>
          </tr>
        </thead>
        <tbody>
          {products.map(prod => (
            <tr key={prod.id} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2">
                <img
                  src={prod.image_url}
                  alt={prod.name}
                  className="max-w-[50px] object-contain"
                />
              </td>
              <td className="px-4 py-2">{prod.name}</td>
              <td className="px-4 py-2 text-right">
                {prod.reviews_count}
              </td>
              <td className="px-4 py-2 text-right">
                {prod.parsed_price.toLocaleString()} ₸
              </td>
              <td className="px-4 py-2 text-right">{prod.rating}</td>
              <td className="px-4 py-2 text-right">
                {prod.computed_revenue.toLocaleString()} ₸
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
