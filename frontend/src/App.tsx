import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { CartProvider } from "./store/cart";
import StoreLayout from "./layouts/StoreLayout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import StoreHome from "./pages/store/Home";
import Category from "./pages/store/Category";
import ProductPage from "./pages/store/Product";
import CartPage from "./pages/store/Cart";
import CheckoutPage from "./pages/store/Checkout";
import { OrderDetailPage, OrdersPage } from "./pages/store/Orders";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="ss-app min-h-screen"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** A ShopSphere page: signed-in customer, store header/footer, Talkshop slot. */
function Store({ children }: { children: ReactNode }) {
  return <RequireAuth><StoreLayout>{children}</StoreLayout></RequireAuth>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Store><StoreHome /></Store>} />
            <Route path="/c/:slug" element={<Store><Category /></Store>} />
            <Route path="/search" element={<Store><Category /></Store>} />
            <Route path="/p/:productId" element={<Store><ProductPage /></Store>} />
            <Route path="/cart" element={<Store><CartPage /></Store>} />
            <Route path="/checkout/:checkoutId" element={<Store><CheckoutPage /></Store>} />
            <Route path="/orders" element={<Store><OrdersPage /></Store>} />
            <Route path="/orders/:orderId" element={<Store><OrderDetailPage /></Store>} />
            {/* The older full-screen chat — retired when the Talkshop panel lands (Phase 5) */}
            <Route path="/assistant" element={<RequireAuth><Chat /></RequireAuth>} />
            <Route path="/dashboard" element={<Navigate to="/orders" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
