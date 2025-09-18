import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthProvider';

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { session } = useAuth();

  if (!session) {
    return <Navigate to="/login" />;
  }

  return children;
};

export default ProtectedRoute;