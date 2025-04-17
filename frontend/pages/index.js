// pages/index.js
import Link from 'next/link';
import Layout from '../components/Layout';
import { useState } from 'react';

export default function Home() {
  const [dateRange, setDateRange] = useState({
    start: '01.03.2023',
    end: '31.03.2023',
  });

  return (
    <Layout>
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Выбор ниши</h2>
        <div className="flex items-center space-x-2">
          <div>
            Период:
            <span className="ml-2 font-semibold">
              {dateRange.start} - {dateRange.end}
            </span>
          </div>
        </div>

        {/* Список категорий */}
        <div className="mt-6">
          <Link href="/categories">
            <a className="underline text-blue-600">Смотреть список категорий</a>
          </Link>
        </div>
      </div>
    </Layout>
  );
}
