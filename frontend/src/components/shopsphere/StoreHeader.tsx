import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, LogOut, Menu, Moon, Package, Search, ShoppingBag, Sun, Truck, User as UserIcon, X } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { useCart } from "../../store/cart";
import { DEPARTMENTS } from "../../api/shop";
import { cx } from "../ui";

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx("flex items-center gap-2.5 shrink-0", className)} aria-label="ShopSphere home">
      <span className="w-7 h-7 rounded-full bg-[radial-gradient(circle_at_30%_30%,#f0a07a,#b4532a_55%,#5c2410)] shadow-[inset_0_-2px_6px_rgba(0,0,0,0.25)]" />
      <span className="text-[15px] sm:text-[17px] font-bold tracking-[0.16em] sm:tracking-[0.22em] text-ink">SHOPSPHERE</span>
    </Link>
  );
}

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("talkshop_theme", dark ? "dark" : "light"); } catch { /* private mode */ }
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

export default function StoreHeader() {
  const { user, isCustomer, logout } = useAuth();
  const location = useLocation();
  const loginHref = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  const { count, bumpKey } = useCart();
  const navigate = useNavigate();
  const [dark, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [q, setQ] = useState("");
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    setMenuOpen(false);
  };

  const navLink = ({ isActive }: { isActive: boolean }) => cx(
    "relative py-2 text-sm font-medium transition-colors",
    isActive ? "text-ink after:absolute after:left-0 after:right-0 after:-bottom-[17px] after:h-[2px] after:bg-ink" : "text-muted hover:text-ink",
  );

  return (
    <header className="sticky top-0 z-[60] bg-canvas/90 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-[1400px] px-3 sm:px-6 h-16 flex items-center gap-1.5 sm:gap-6">
        <button className="lg:hidden -ml-1 p-2 text-ink" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Wordmark />

        <nav className="hidden lg:flex items-center gap-5 xl:gap-7 ml-4" aria-label="Departments">
          <NavLink to="/" end className={navLink}>Home</NavLink>
          {DEPARTMENTS.map((d) => <NavLink key={d.slug} to={`/c/${d.slug}`} className={navLink}>{d.label}</NavLink>)}
        </nav>

        <div className="flex-1" />

        <form onSubmit={submit} className="hidden md:flex items-center gap-2 h-10 w-64 rounded-full bg-panel px-4 border border-transparent focus-within:border-line-strong">
          <Search size={15} className="text-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ShopSphere"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint" aria-label="Search products" />
        </form>

        <button onClick={toggleTheme} className="p-2 rounded-full text-muted hover:text-ink hover:bg-panel" title={dark ? "Light mode" : "Dark mode"}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <Link to="/cart" className="relative p-2 rounded-full text-ink hover:bg-panel" aria-label={`Cart, ${count} items`}>
          <ShoppingBag size={20} />
          {count > 0 && (
            <span key={bumpKey} className="ss-bump absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-bold grid place-items-center">
              {count}
            </span>
          )}
        </Link>

        {!isCustomer && (
          <Link to={loginHref} className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-full border border-line-strong text-sm font-medium hover:border-ink">
            <UserIcon size={16} /> Log in
          </Link>
        )}
        {isCustomer && user && (
          <div ref={accountRef} className="relative hidden sm:block">
            <button onClick={() => setAccountOpen((o) => !o)} className="flex items-center gap-2 pl-1 pr-2 h-10 rounded-full hover:bg-panel">
              <span className="w-8 h-8 rounded-full bg-ink text-canvas grid place-items-center text-sm font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="sr-only xl:not-sr-only text-sm font-medium max-w-[120px] truncate">{user.name.split(" ")[0]}</span>
              <ChevronDown size={14} className="text-muted" />
            </button>
            {accountOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-line bg-canvas shadow-float p-1.5">
                <Link to="/orders" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-panel">
                  <Package size={16} /> My orders
                </Link>
                <Link to="/track" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-panel">
                  <Truck size={16} /> Track order
                </Link>
                <button onClick={() => { setAccountOpen(false); navigate("/", { replace: true }); logout(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm hover:bg-panel text-left">
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {menuOpen && (
        <div className="lg:hidden border-t border-line bg-canvas px-4 pb-4">
          <form onSubmit={submit} className="flex items-center gap-2 h-11 mt-3 rounded-full bg-panel px-4">
            <Search size={15} className="text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ShopSphere" className="w-full bg-transparent text-sm outline-none" />
          </form>
          <nav className="flex flex-col mt-2">
            <NavLink to="/" end onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cx("py-3 border-b border-line text-[15px]", isActive ? "font-semibold" : "text-ink-soft")}>Home</NavLink>
            {DEPARTMENTS.map((d) => (
              <NavLink key={d.slug} to={`/c/${d.slug}`} onClick={() => setMenuOpen(false)}
                className={({ isActive }) => cx("py-3 border-b border-line text-[15px]", isActive ? "font-semibold" : "text-ink-soft")}>{d.label}</NavLink>
            ))}
            {isCustomer ? (
              <>
                <Link to="/orders" onClick={() => setMenuOpen(false)} className="py-3 border-b border-line text-[15px] text-ink-soft">My orders</Link>
                <button onClick={() => { setMenuOpen(false); navigate("/", { replace: true }); logout(); }} className="py-3 text-left text-[15px] text-ink-soft">Log out</button>
              </>
            ) : (
              <Link to={loginHref} onClick={() => setMenuOpen(false)} className="py-3 border-b border-line text-[15px] font-medium">Log in or create an account</Link>
            )}
            <Link to="/track" onClick={() => setMenuOpen(false)} className="py-3 text-[15px] text-ink-soft">Track order</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
