import Header from "@/components/Header";
import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Header />
      <main className="container mx-auto p-8 text-center">
        <h2 className="text-4xl font-bold mb-4">
          Bienvenido a Trade Binance
        </h2>
        <p className="text-xl text-gray-400">
          Tu plataforma para el trading de criptomonedas.
        </p>
        {/* Los componentes de trading irán aquí */}
      </main>
      <div className="absolute bottom-0 w-full">
        <MadeWithDyad />
      </div>
    </div>
  );
};

export default Index;