import { NavLink } from 'react-router-dom';
import { Hand, Signal, Home, History } from 'lucide-react'; // Importar el icono History
import { cn } from '@/lib/utils';

const Sidebar = () => {
  return (
    <aside className="w-64 bg-gray-800 text-white flex-col border-r border-gray-700 hidden md:flex">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xl font-bold text-yellow-400">Menú</h2>
      </div>
      <nav className="flex-grow p-4">
        <ul className="space-y-2">
          <li>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "flex items-center p-2 rounded-md hover:bg-gray-700 transition-colors font-medium",
                  isActive ? "bg-yellow-500 text-gray-900" : "text-gray-300"
                )
              }
            >
              <Home className="mr-3 h-5 w-5" />
              Inicio
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/manual-trading"
              className={({ isActive }) =>
                cn(
                  "flex items-center p-2 rounded-md hover:bg-gray-700 transition-colors font-medium",
                  isActive ? "bg-yellow-500 text-gray-900" : "text-gray-300"
                )
              }
            >
              <Hand className="mr-3 h-5 w-5" />
              Trading Manual
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/signals-trading"
              className={({ isActive }) =>
                cn(
                  "flex items-center p-2 rounded-md hover:bg-gray-700 transition-colors font-medium",
                  isActive ? "bg-yellow-500 text-gray-900" : "text-gray-300"
                )
              }
            >
              <Signal className="mr-3 h-5 w-5" />
              Trading por Señales
            </NavLink>
          </li>
          <li> {/* Nuevo enlace para el historial */}
            <NavLink
              to="/trade-history"
              className={({ isActive }) =>
                cn(
                  "flex items-center p-2 rounded-md hover:bg-gray-700 transition-colors font-medium",
                  isActive ? "bg-yellow-500 text-gray-900" : "text-gray-300"
                )
              }
            >
              <History className="mr-3 h-5 w-5" />
              Historial de Operaciones
            </NavLink>
          </li>
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;