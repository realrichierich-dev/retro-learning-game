import { NavLink, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useTenant } from "../contexts/TenantContext";

export default function DashboardShell() {
  const { tenant, membership, isAdmin } = useTenant();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded text-sm font-medium ${
      isActive ? "bg-white/15" : "text-gray-300 hover:bg-white/5"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {tenant?.logo_url ? (
            <img src={tenant.logo_url} alt="" className="h-7 w-7 rounded object-cover" />
          ) : (
            <div
              className="h-7 w-7 rounded"
              style={{ background: "var(--theme-primary)" }}
              aria-hidden
            />
          )}
          <span className="font-semibold">{tenant?.name ?? "..."}</span>
          <span className="text-xs text-gray-500 uppercase">{membership?.role}</span>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink to="/uploads" className={linkClass}>
            Uploads
          </NavLink>
          {isAdmin && (
            <NavLink to="/branding" className={linkClass}>
              Branding
            </NavLink>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            className="ml-2 px-3 py-2 rounded text-sm text-gray-400 hover:bg-white/5"
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
