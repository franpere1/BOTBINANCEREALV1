import React from 'react';
import { useAuth } from '@/context/AuthProvider';
import { supabase } from '@/integrations/supabase/client';
import { Button } from './ui/button';
import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import BinanceSummaryCard from './BinanceSummaryCard'; // Importar el nuevo componente

const Header = () => {
  const { session } = useAuth();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <header className="bg-gray-800 text-white p-4 shadow-md border-b border-gray-700">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold text-yellow-400 hover:text-yellow-300 transition-colors">
          Trade Binance
        </Link>
        <div className="flex items-center space-x-4"> {/* Contenedor para el resumen y el botón de cerrar sesión */}
          {session && <BinanceSummaryCard />} {/* Mostrar el resumen si hay sesión */}
          {session && (
            <Button variant="ghost" onClick={handleLogout} className="text-white hover:bg-gray-700">
              <LogOut className="mr-2 h-4 w-4" />
              Cerrar Sesión
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;