import { Link, Outlet } from "react-router-dom";
import StoreHeader, { Wordmark } from "../components/shopsphere/StoreHeader";
import { DEPARTMENTS } from "../api/shop";
import TalkshopPanel from "../components/talkshop/TalkshopPanel";
import { TalkshopProvider } from "../talkshop/TalkshopContext";
import { useAuth } from "../auth/AuthContext";

/**
 * Every ShopSphere page: header, the page itself, footer — with the Talkshop
 * assistant docked on the right. This is a layout route, so the panel (and
 * its conversation) stays mounted while the shopper moves between pages.
 */
export default function StoreLayout() {
  const { user } = useAuth();
  // Keyed by identity: after a visitor logs in, Talkshop reloads the same
  // conversation (now owned by the account) and carries on.
  return (
    <TalkshopProvider key={user?.user_id ?? "anonymous"}>
      <div className="ss-app min-h-screen flex flex-col">
        <StoreHeader />
        <div className="flex-1 flex">
          <main className="flex-1 min-w-0">
            <Outlet />
            <StoreFooter />
          </main>
          <TalkshopPanel />
        </div>
      </div>
    </TalkshopProvider>
  );
}

function StoreFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-panel">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-12 grid gap-10 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="text-sm text-muted leading-relaxed max-w-xs">
            Everyday essentials, done well. Ask <span className="text-talk font-medium">Talkshop</span>, our shopping
            assistant, whenever you need a hand.
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Shop</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {DEPARTMENTS.map((d) => <li key={d.slug}><Link to={`/c/${d.slug}`} className="hover:underline">{d.label}</Link></li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Help</h4>
          <ul className="flex flex-col gap-2 text-sm text-ink-soft">
            <li>Free standard delivery</li><li>Express delivery $9.99</li><li>30-day returns</li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-3">Account</h4>
          <ul className="flex flex-col gap-2 text-sm">
            <li><Link to="/orders" className="hover:underline">My orders</Link></li>
            <li><Link to="/track" className="hover:underline">Track order</Link></li>
            <li><Link to="/cart" className="hover:underline">Cart</Link></li>
          </ul>
        </div>
      </div>
      {/* Extra room on phones so the floating "Ask Talkshop" button never covers content */}
      <div className="border-t border-line pt-5 pb-24 lg:pb-5 text-center text-xs text-faint">© ShopSphere · Demo store</div>
    </footer>
  );
}
