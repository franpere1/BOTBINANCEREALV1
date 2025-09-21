import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthProvider';
import { Skeleton } from '@/components/ui/skeleton'; // Importar Skeleton

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    // Mostrar un esqueleto o spinner mientras se carga la sesión
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-full max-w-md p-8 rounded-lg shadow-lg bg-gray-800 text-white space-y-4">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" />;
  }

  return children;
};

export default ProtectedRoute;