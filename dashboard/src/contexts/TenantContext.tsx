import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  theme_primary_color: string;
  theme_accent_color: string;
  theme_bg_color: string;
  plan_tier: "free" | "paid";
  monthly_generation_limit: number;
}

export interface Membership {
  id: string;
  tenant_id: string;
  role: "owner" | "admin" | "member";
}

interface TenantContextValue {
  session: Session | null;
  loading: boolean;
  tenant: Tenant | null;
  membership: Membership | null;
  isAdmin: boolean;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

function applyTheme(tenant: Tenant) {
  const root = document.documentElement.style;
  root.setProperty("--theme-primary", tenant.theme_primary_color);
  root.setProperty("--theme-accent", tenant.theme_accent_color);
  root.setProperty("--theme-bg", tenant.theme_bg_color);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);

  async function loadTenant(userId: string) {
    // A user can belong to more than one tenant in principle (the schema
    // doesn't forbid it), but this dashboard only handles the single-org
    // case for Phase 1 -- picks the first membership found. A tenant
    // switcher is a reasonable follow-up once multi-org membership is a
    // real use case, not before.
    const { data: membershipRow } = await supabase
      .from("memberships")
      .select("id, tenant_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!membershipRow) {
      setMembership(null);
      setTenant(null);
      return;
    }
    setMembership(membershipRow as Membership);

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", membershipRow.tenant_id)
      .single();

    if (tenantRow) {
      setTenant(tenantRow as Tenant);
      applyTheme(tenantRow as Tenant);
    }
  }

  async function refreshTenant() {
    if (session?.user) {
      await loadTenant(session.user.id);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadTenant(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadTenant(newSession.user.id);
      } else {
        setTenant(null);
        setMembership(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const isAdmin = membership?.role === "owner" || membership?.role === "admin";

  return (
    <TenantContext.Provider value={{ session, loading, tenant, membership, isAdmin, refreshTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}
