import ApiConfig from "@/components/ApiConfig";
import BalanceDisplay from "@/components/BalanceDisplay";
import MarketAdvisor from "@/components/MarketAdvisor"; // Importar el nuevo componente

const Index = () => {
  return (
    <div className="flex flex-col items-center">
      <div className="text-center mb-8">
          <h2 className="text-4xl font-bold mb-4 text-yellow-400">
            Bienvenido a Trade Binance
          </h2>
          <p className="text-xl text-gray-400 max-w-2xl">
            Tu plataforma para el trading de criptomonedas. Conecta tu cuenta de Binance para empezar.
          </p>
      </div>
      
      <div className="w-full space-y-8">
        <MarketAdvisor /> {/* Integrar el Asesor de Mercado aquí */}
        <ApiConfig />
        <BalanceDisplay />
      </div>
    </div>
  );
};

export default Index;