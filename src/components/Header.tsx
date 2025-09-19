import React from 'react';
import { useAuth } from '@/context/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { Button } from './ui/button';
import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import BinanceSummaryCard from './BinanceSummaryCard';
import MobileSidebar from './MobileSidebar'; // Importar el nuevo componente

const Header = () => {
  const { session } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <header className="bg-gray-800 text-white p-4 shadow-md border-b border-gray-700">
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center">
          {session && <MobileSidebar />} {/* Mostrar el botón de menú en móviles si hay sesión */}
          <Link to="/" className="text-2xl font-bold text-yellow-400 hover:text-yellow-300 transition-colors ml-4 md:ml-0">
            Trade Binance
          </Link>
        </div>
        <div className="flex items-center space-x-4">
          {session && <BinanceSummaryCard />}
          {session && (
            <Button variant="ghost" onClick={handleLogout} className="text-white hover:bg-gray-700">
              <LogOut className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Cerrar Sesión</span> {/* Ocultar texto en pantallas muy pequeñas */}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;