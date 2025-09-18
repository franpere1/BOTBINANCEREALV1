import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

const ManualTrading = () => {
  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-lg bg-gray-800 border-gray-700 text-center">
        <CardHeader>
          <CardTitle className="text-yellow-400 text-2xl">Trading Manual</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center p-8">
          <Construction className="h-16 w-16 text-yellow-500 mb-4" />
          <p className="text-xl text-gray-300">
            Esta sección está en construcción.
          </p>
          <p className="text-gray-400 mt-2">
            Próximamente podrás operar manualmente desde aquí.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default ManualTrading;