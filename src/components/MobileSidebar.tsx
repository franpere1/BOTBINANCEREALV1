"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar'; // Importar el Sidebar existente

const MobileSidebar = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden text-white">
          <Menu className="h-6 w-6" />
          <span className="sr-only">Abrir menú</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64 bg-gray-800 border-r border-gray-700">
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-xl font-bold text-yellow-400">Menú</h2>
          </div>
          <Sidebar onLinkClick={() => setIsOpen(false)} /> {/* Pasar prop para cerrar al hacer clic */}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileSidebar;