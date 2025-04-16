// pages/_app.js
import '../styles/globals.css';  // Подключаем глобальные стили

function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

export default MyApp;
