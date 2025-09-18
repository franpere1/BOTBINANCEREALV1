import ManualTradeForm from '@/components/ManualTradeForm';
import ActiveTrades from '@/components/ActiveTrades';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// Eliminado AlertTriangle

const ManualTrading = () => {
  return (
    <div className="space-y-8">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Trading Manual</CardTitle>
          <CardDescription className="text-gray-400">
            Crea una orden de compra y establece un objetivo de ganancia. El sistema venderá automáticamente cuando se alcance el objetivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualTradeForm />
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Operaciones Activas</CardTitle>
           {/* Eliminado el mensaje de advertencia */}
        </CardHeader>
        <CardContent>
          <ActiveTrades />
        </CardContent>
      </Card>
    </div>
  );
};

export default ManualTrading;