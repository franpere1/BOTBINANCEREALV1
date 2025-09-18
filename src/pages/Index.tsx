import Header from "@/components/Header";
import ApiConfig from "@/components/ApiConfig";
import BalanceDisplay from "@/components/BalanceDisplay";
import { MadeWithDyad } from "@/components/made-with-dyad";

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Header />
      <main className="container mx-auto p-8 flex-grow">
        <div className="flex flex-col items-center text-center mb-8">
            <h2 className="text-4xl font-bold mb-4">
              Bienvenido a Trade Binance
            </h2>
            <p className="text-xl text-gray-400 max-w-2xl">
              Tu plataforma para el trading de criptomonedas. Conecta tu cuenta de Binance para empezar.
            </p>
        </div>
        
        <div className="space-y-8">
          <ApiConfig />
          <BalanceDisplay />
        </div>

      </main>
      <footer className="w-full py-4">
        <MadeWithDyad />
      </footer>
    </div>
  );
};

export default Index;