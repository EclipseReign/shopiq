const Layout = ({ children }) => {
  return (
    <div className="layout">
      <header>
        <h1>Kaspi Analytics Dashboard</h1>
      </header>
      <main>{children}</main>
      <footer>
        <p>&copy; 2025 EclipseReign. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Layout;
