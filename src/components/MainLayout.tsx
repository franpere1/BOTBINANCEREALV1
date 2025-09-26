import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import MobileSidebar from './MobileSidebar'; // Importar MobileSidebar

const MainLayout = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col font-sans">
      <Header />
      <div className="flex flex-1">
        <aside className="w-64 bg-gray-800 text-white flex-col border-r border-gray-700 hidden md:flex"> {/* Ocultar en móviles */}
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-xl font-bold text-yellow-400">Menú</h2>
          </div>
          <Sidebar />
        </aside>
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;