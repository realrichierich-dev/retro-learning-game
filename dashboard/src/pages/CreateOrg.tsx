import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useTenant } from "../contexts/TenantContext";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

export default function CreateOrg() {
  const { refreshTenant } = useTenant();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    // Slug collisions (tenants.slug is unique) are rare but possible if two
    // orgs pick the same name -- append a short random suffix and retry
    // once rather than surfacing a raw DB constraint error on first try.
    const baseSlug = slugify(name);
    const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const { error: rpcError } = await supabase.rpc("create_tenant", {
      tenant_name: name.trim(),
      tenant_slug: slug,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSubmitting(false);
      return;
    }

    await refreshTenant();
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white/5 border border-white/10 rounded-lg p-6">
        <h1 className="text-xl font-semibold mb-1">Create your organization</h1>
        <p className="text-sm text-gray-400 mb-4">
          You're signed in, but not part of an organization yet. Create one to get started -- you'll be its owner.
        </p>
        <label className="block text-sm mb-1" htmlFor="org-name">
          Organization name
        </label>
        <input
          id="org-name"
          className="w-full rounded border border-white/20 bg-black/30 px-3 py-2 mb-3 outline-none focus:border-[var(--theme-primary)]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lincoln Elementary, Acme Corp L&D"
          required
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded px-3 py-2 font-medium disabled:opacity-50"
          style={{ background: "var(--theme-primary)", color: "var(--theme-bg)" }}
        >
          {submitting ? "Creating..." : "Create organization"}
        </button>
      </form>
    </div>
  );
}
