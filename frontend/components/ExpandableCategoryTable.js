import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function ExpandableCategoryTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // 1) Подгружаем корневые категории
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/categories`
        );
        const { categories } = await res.json();
        // каждый row: добавляем level и expanded, children=[]
        setRows(
          categories.map(cat => ({
            ...cat,
            level: 0,
            expanded: false,
            children: []
          }))
        );
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 2) Обработчик клика по строке
  const onToggle = async (idx) => {
    const row = rows[idx];
    // 2.1) если лист – приводим на страницу detail
    if (!row.has_children) {
      return router.push(`/categories/${row.id}`);
    }

    // 2.2) если уже раскрыт – схлопываем
    if (row.expanded) {
      setRows(prev => {
        const out = [...prev];
        // удалить все строки, чей level > row.level, до первого соседа на том же уровне
        let end = idx + 1;
        while (end < out.length && out[end].level > row.level) end++;
        out.splice(idx + 1, end - (idx + 1));
        out[idx] = { ...row, expanded: false };
        return out;
      });
      return;
    }

    // 2.3) если ещё не раскрыт – нужно загрузить детей (или просто показать, если уже в row.children)
    if (row.children.length > 0) {
      // уже загружены – просто раскрываем
      setRows(prev => {
        const out = [...prev];
        out[idx] = { ...row, expanded: true };
        out.splice(idx + 1, 0, ...row.children);
        return out;
      });
    } else {
      // загрузить из API
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/categories?parentId=${row.id}`
        );
        const { categories: kids } = await res.json();
        const formatted = kids.map(child => ({
          ...child,
          level: row.level + 1,
          expanded: false,
          children: []
        }));
        setRows(prev => {
          const out = [...prev];
          out[idx] = { ...row, expanded: true, children: formatted };
          out.splice(idx + 1, 0, ...formatted);
          return out;
        });
      } catch (err) {
        console.error('Error loading subcategories:', err);
      }
    }
  };

  if (loading) {
    return <p>Загрузка категорий...</p>;
  }

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
          {rows.map((row, i) => (
            <tr key={`${row.id}-${row.level}`} className="border-b hover:bg-gray-50">
              <td
                className="px-4 py-2 flex items-center"
                style={{ paddingLeft: `${row.level * 1.5}rem` }}
              >
                {row.has_children ? (
                  <button
                    onClick={() => onToggle(i)}
                    className="mr-2 focus:outline-none"
                  >
                    {row.expanded ? '▼' : '▶'}
                  </button>
                ) : (
                  <span style={{ width: '1.25rem', display: 'inline-block' }} />
                )}

                {row.has_children ? (
                  <span
                    className="cursor-pointer"
                    onClick={() => onToggle(i)}
                  >
                    {row.name}
                  </span>
                ) : (
                  <Link href={`/categories/${row.id}`}>
                    <a className="text-blue-600 underline">
                      {row.name}
                    </a>
                  </Link>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                {row.sales.toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right">
                {row.revenue.toLocaleString()} ₸
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
