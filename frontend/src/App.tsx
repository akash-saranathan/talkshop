import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { CartProvider } from "./store/cart";
import StoreLayout from "./layouts/StoreLayout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import StoreHome from "./pages/store/Home";
import Category from "./pages/store/Category";
import ProductPage from "./pages/store/Product";
import CartPage from "./pages/store/Cart";
import CheckoutPage from "./pages/store/Checkout";
import { OrderDetailPage, OrdersPage } from "./pages/store/Orders";
import TrackOrderPage from "./pages/store/Track";
import { OffersPage, RewardsPage } from "./pages/store/Member";
import AccountPage from "./pages/store/Account";
import { MemberProvider, useMember } from "./member/MemberContext";
import MemberGate from "./pages/store/MemberGate";
import { PasskeyProvider } from "./member/PasskeyContext";

/** Waits until the shopper has an identity (a visitor session at least). */
function AuthReady({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  if (loading) return <div className="ss-app min-h-screen"><Spinner /></div>;
  return <>{children}</>;
}

/** My Orders needs an account: visitors log in, then come back. (Part 2: the
 *  whole marketplace is for eligible cardmembers; StoreLayout shows the gate
 *  page otherwise, and the server refuses every marketplace API.) */
function RequireCustomer({ children }: { children: ReactNode }) {
  const { isCustomer } = useAuth();
  const location = useLocation();
  if (!isCustomer) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}

/** Cart, checkout, orders, offers, rewards and account are for eligible
 *  cardmembers. Everyone else sees the membership page (sign in, create an
 *  account, or verify a card); the server enforces the same rule. */
function RequireMember({ children }: { children: ReactNode }) {
  const { eligible } = useMember();
  return eligible ? <>{children}</> : <MemberGate />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MemberProvider>
        <PasskeyProvider>
        <CartProvider>
          <AuthReady>
            <Routes>
              <Route path="/login" element={<Login />} />
              {/* One layout keeps Talkshop mounted across pages; it shows the member gate to non-members */}
              <Route element={<StoreLayout />}>
                <Route path="/" element={<StoreHome />} />
                <Route path="/c/:slug" element={<Category />} />
                <Route path="/search" element={<Category />} />
                <Route path="/p/:productId" element={<ProductPage />} />
                <Route path="/membership" element={<MemberGate />} />
                <Route path="/cart" element={<RequireMember><CartPage /></RequireMember>} />
                <Route path="/checkout/:checkoutId" element={<RequireMember><CheckoutPage /></RequireMember>} />
                <Route path="/track" element={<RequireMember><TrackOrderPage /></RequireMember>} />
                <Route path="/offers" element={<RequireMember><OffersPage /></RequireMember>} />
                <Route path="/rewards" element={<RequireMember><RewardsPage /></RequireMember>} />
                <Route path="/account" element={<RequireMember><AccountPage /></RequireMember>} />
                <Route path="/orders" element={<RequireMember><OrdersPage /></RequireMember>} />
                <Route path="/orders/:orderId" element={<RequireMember><OrderDetailPage /></RequireMember>} />
              </Route>
              <Route path="/dashboard" element={<Navigate to="/orders" replace />} />
              <Route path="/assistant" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthReady>
        </CartProvider>
        </PasskeyProvider>
        </MemberProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
