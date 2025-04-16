export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-600 text-white py-4 shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-2xl font-bold">Kaspi Analytics Dashboard</h1>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>

      <footer className="bg-gray-800 text-white py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          © {new Date().getFullYear()} Kaspi Market Intelligence. All rights reserved.
        </div>
      </footer>
    </div>
  );
}