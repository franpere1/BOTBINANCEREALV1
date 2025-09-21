import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4 text-yellow-400">404</h1>
        <p className="text-xl text-gray-400 mb-4">Oops! Página no encontrada</p>
        <a href="/" className="text-yellow-500 hover:text-yellow-300 underline">
          Volver al Inicio
        </a>
      </div>
    </div>
  );
};

export default NotFound;