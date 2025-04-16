// components/CategoryCardList.js
import Link from 'next/link';

export default function CategoryCardList({ categories }) {
  return (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="min-w-full table-auto">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2">Название</th>
            <th className="px-4 py-2">Товаров</th>
            <th className="px-4 py-2">Выручка</th>
            <th className="px-4 py-2">Статус</th>
          </tr>
        </thead>
        <tbody>
          {categories.map(cat => (
            <tr key={cat.id} className="border-b hover:bg-gray-50">
              <td className="px-4 py-2">
                <Link href={`/categories/${cat.id}`}>
                  <a className="text-blue-600 underline">{cat.name}</a>
                </Link>
              </td>
              <td className="px-4 py-2">{cat.products_count || 0}</td>
              <td className="px-4 py-2">{(cat.revenue || 0).toLocaleString()} ₸</td>
              <td className="px-4 py-2">
                {renderStatusDot(cat.status)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderStatusDot(status) {
  // Например, "open" / "restricted" / "closed" / "empty"
  switch (status) {
    case 'open':
      return <span className="text-green-600">●</span>;
    case 'restricted':
      return <span className="text-yellow-600">●</span>;
    case 'closed':
      return <span className="text-red-600">●</span>;
    default:
      return <span className="text-blue-600">●</span>;
  }
}
