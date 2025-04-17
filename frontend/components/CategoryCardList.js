import Link from 'next/link';

export default function CategoryCardList({ categories }) {
  return (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="min-w-full table-auto">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 text-left">Название</th>
            <th className="px-4 py-2 text-right">Продажи</th>
            <th className="px-4 py-2 text-right">Выручка</th>
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
              <td className="px-4 py-2 text-right">
                {cat.sales.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right">
                {cat.revenue.toLocaleString()} ₸
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
