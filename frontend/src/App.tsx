import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader } from "lucide-react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Chat from "./pages/Chat";
import GenericChat from "./pages/GenericChat";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import PaymentResult from "./pages/PaymentResult";
import Dashboard from "./pages/Dashboard";

// No login screen: the app opens straight into the assistant, signed in as
// the persistent demo identity (AuthContext bootstraps the demo session).
// While that bootstrap runs, show a loader rather than any login UI.
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center">
        <Loader className="animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* main entry: original Talk Shop */}
          <Route path="/" element={<RequireAuth><Chat /></RequireAuth>} />

          {/* shared routes */}
          <Route path="/cart" element={<RequireAuth><Cart /></RequireAuth>} />
          <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="/payment-result/:orderId" element={<RequireAuth><PaymentResult /></RequireAuth>} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
