import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useTenant } from "../contexts/TenantContext";

function applyPreview(primary: string, accent: string, bg: string) {
  const root = document.documentElement.style;
  root.setProperty("--theme-primary", primary);
  root.setProperty("--theme-accent", accent);
  root.setProperty("--theme-bg", bg);
}

export default function Branding() {
  const { tenant, isAdmin, refreshTenant } = useTenant();

  // Hooks must run unconditionally on every render (React's Rules of
  // Hooks) -- the isAdmin/tenant guards below have to come *after* every
  // useState call, not before, even though in practice App.tsx's routing
  // already guarantees `tenant` is set by the time this page renders.
  const [primary, setPrimary] = useState(tenant?.theme_primary_color ?? "#7ee787");
  const [accent, setAccent] = useState(tenant?.theme_accent_color ?? "#58a6ff");
  const [bg, setBg] = useState(tenant?.theme_bg_color ?? "#0f0f1a");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(tenant?.logo_url ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // isAdmin already gates the nav link, but RLS is the real enforcement --
  // this is just a friendlier message than a silent failed update if
  // someone lands here directly (e.g. a bookmarked URL after a role change).
  if (!isAdmin) {
    return <p className="text-gray-400">Only organization admins can change branding.</p>;
  }
  if (!tenant) return null;

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    setLogoPreviewUrl(URL.createObjectURL(file));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    let logoUrl = tenant!.logo_url;

    if (logoFile) {
      // Path convention every storage RLS policy relies on: first segment
      // is the tenant id (see supabase/migrations -- storage.foldername()).
      const ext = logoFile.name.split(".").pop() || "png";
      const path = `${tenant!.id}/logo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("tenant-logos")
        .upload(path, logoFile, { upsert: true });

      if (uploadError) {
        setError(uploadError.message);
        setSaving(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from("tenant-logos").getPublicUrl(path);
      logoUrl = publicUrlData.publicUrl;
    }

    const { error: updateError } = await supabase
      .from("tenants")
      .update({
        theme_primary_color: primary,
        theme_accent_color: accent,
        theme_bg_color: bg,
        logo_url: logoUrl,
      })
      .eq("id", tenant!.id);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSaved(true);
    await refreshTenant();
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">Branding</h1>

      <div className="mb-6">
        <label className="block text-sm mb-2">Logo</label>
        <div className="flex items-center gap-4">
          {logoPreviewUrl ? (
            <img src={logoPreviewUrl} alt="" className="h-14 w-14 rounded object-cover border border-white/10" />
          ) : (
            <div className="h-14 w-14 rounded border border-dashed border-white/20" />
          )}
          <input type="file" accept="image/*" onChange={handleLogoChange} className="text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <ColorField label="Primary" value={primary} onChange={(v) => { setPrimary(v); applyPreview(v, accent, bg); setSaved(false); }} />
        <ColorField label="Accent" value={accent} onChange={(v) => { setAccent(v); applyPreview(primary, v, bg); setSaved(false); }} />
        <ColorField label="Background" value={bg} onChange={(v) => { setBg(v); applyPreview(primary, accent, v); setSaved(false); }} />
      </div>

      <div
        className="rounded-lg border border-white/10 p-4 mb-6"
        style={{ background: "var(--theme-bg)" }}
      >
        <p className="text-xs text-gray-400 mb-2">Live preview</p>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded font-medium text-sm" style={{ background: "var(--theme-primary)", color: bg }}>
            Primary button
          </span>
          <span className="px-3 py-1.5 rounded font-medium text-sm" style={{ background: "var(--theme-accent)", color: bg }}>
            Accent button
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {saved && <p className="text-sm mb-3" style={{ color: "var(--theme-primary)" }}>Saved.</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded px-4 py-2 font-medium disabled:opacity-50"
        style={{ background: "var(--theme-primary)", color: "var(--theme-bg)" }}
      >
        {saving ? "Saving..." : "Save branding"}
      </button>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 rounded border border-white/20 bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-white/20 bg-black/30 px-2 py-1.5 text-sm font-mono"
        />
      </div>
    </div>
  );
}
