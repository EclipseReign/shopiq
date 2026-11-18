import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Home from "./pages/index";
import "./styles/globals.css";
import "./styles/merchant.css";
import { AuthProvider } from "./lib/auth";

const Categories = lazy(() => import("./pages/categories"));
const CategoryDetail = lazy(() => import("./pages/categories/[id]"));
const Dashboard = lazy(() => import("./pages/dashboard"));
const Scraper = lazy(() => import("./pages/scraper"));
const Login = lazy(() => import("./pages/login"));
const Stores = lazy(() => import("./pages/stores"));
const Store = lazy(() => import("./pages/store"));
const Competitors = lazy(() => import("./pages/competitors"));
const Coverage = lazy(() => import("./pages/coverage"));

function NavigationScroll() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <NavigationScroll />
      <Suspense
        fallback={
          <div className="state-panel" role="status">
            Загружаем страницу…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/categories/:id" element={<CategoryDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/scraper" element={<Scraper />} />
          <Route path="/login" element={<Login />} />
          <Route path="/stores" element={<Stores />} />
          <Route path="/stores/:id" element={<Store />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/coverage" element={<Coverage />} />
          <Route
            path="*"
            element={
              <div className="state-panel">
                <h1>Страница не найдена</h1>
                <a href="/">Перейти к обзору</a>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
