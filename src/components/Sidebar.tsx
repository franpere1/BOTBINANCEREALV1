import { NavLink } from 'react-router-dom';
import { Hand, Signal, Home, History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onLinkClick?: () => void;
}

const Sidebar = ({ onLinkClick }: SidebarProps) => {
  return (
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
            onClick={onLinkClick}
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
            onClick={onLinkClick}
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
            onClick={onLinkClick}
          >
            <Signal className="mr-3 h-5 w-5" />
            Trading por Señales
          </NavLink>
        </li>
        <li>
          <NavLink
            to="/trade-history"
            className={({ isActive }) =>
              cn(
                "flex items-center p-2 rounded-md hover:bg-gray-700 transition-colors font-medium",
                isActive ? "bg-yellow-500 text-gray-900" : "text-gray-300"
              )
            }
            onClick={onLinkClick}
          >
            <History className="mr-3 h-5 w-5" />
            Historial de Operaciones
          </NavLink>
        </li>
      </ul>
    </nav>
  );
};

export default Sidebar;