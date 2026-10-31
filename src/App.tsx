import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { AppShell } from './components/AppShell';

const RootContent: React.FC = () => {
  const { isReady, session } = useAuth();

  if (!isReady) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
        <div className="text-2xl font-bold text-stone-700">Đang mở Sổ Bếp Nhà Mình...</div>
      </div>
    );
  }

  return session ? <AppShell /> : <LoginScreen />;
};

export function App() {
  return (
    <AuthProvider>
      <RootContent />
    </AuthProvider>
  );
}

export default App;
