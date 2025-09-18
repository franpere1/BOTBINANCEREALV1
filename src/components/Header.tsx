import React from 'react';

const Header = () => {
  return (
    <header className="bg-gray-800 text-white p-4 shadow-md">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-2xl font-bold text-yellow-400">Trade Binance</h1>
        {/* Aquí podríamos agregar enlaces de navegación más adelante */}
      </div>
    </header>
  );
};

export default Header;