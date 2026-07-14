import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTenant } from "../contexts/TenantContext";

interface ContentSet {
  id: string;
  title: string;
  source_type: "pptx" | "video" | "txt";
  status: "pending" | "processing" | "ready" | "failed";
  created_at: string;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mp3", "m4a", "wav", "webm", "mpeg", "mpga"]);

function detectSourceType(filename: string): "pptx" | "video" | "txt" | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (ext === "pptx") return "pptx";
  if (ext === "txt") return "txt";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export default function Uploads() {
  const { tenant, session } = useTenant();
  const [contentSets, setContentSets] = useState<ContentSet[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadContentSets() {
    setLoadingList(true);
    const { data } = await supabase
      .from("content_sets")
      .select("id, title, source_type, status, created_at")
      .order("created_at", { ascending: false });
    setContentSets((data as ContentSet[]) ?? []);
    setLoadingList(false);
  }

  useEffect(() => {
    loadContentSets();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !tenant || !session) return;

    const sourceType = detectSourceType(file.name);
    if (!sourceType) {
      setError("Unsupported file type. Use .pptx, or a video/audio file (.mp4, .mov, .mp3, .m4a, .wav, .webm).");
      return;
    }

    setUploading(true);
    setError(null);

    // Path convention every storage RLS policy relies on: first segment is
    // the tenant id. A timestamp prefix avoids collisions between two
    // uploads with the same original filename.
    const path = `${tenant.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("tenant-uploads").upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(false);
      return;
    }

    // This insert is where the monthly usage cap (can_create_content_set()
    // in the migration) is actually enforced -- if the tenant is over its
    // limit, RLS rejects the row and this comes back as a policy-violation
    // error, not a generic failure.
    const { error: insertError } = await supabase.from("content_sets").insert({
      tenant_id: tenant.id,
      title: title.trim() || file.name,
      source_type: sourceType,
      source_storage_path: path,
      created_by: session.user.id,
    });

    setUploading(false);

    if (insertError) {
      if (insertError.message.toLowerCase().includes("row-level security")) {
        setError(
          `You've hit this month's upload limit (${tenant.monthly_generation_limit} on the ${tenant.plan_tier} plan). ` +
            "It resets next calendar month."
        );
      } else {
        setError(insertError.message);
      }
      return;
    }

    setTitle("");
    setFile(null);
    await loadContentSets();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-4">Content uploads</h1>

      <form onSubmit={handleUpload} className="bg-white/5 border border-white/10 rounded-lg p-4 mb-6">
        <label className="block text-sm mb-1" htmlFor="title">
          Title
        </label>
        <input
          id="title"
          className="w-full rounded border border-white/20 bg-black/30 px-3 py-2 mb-3 outline-none focus:border-[var(--theme-primary)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Unit 3: Photosynthesis"
        />
        <label className="block text-sm mb-1" htmlFor="file">
          Deck or video/audio file
        </label>
        <input
          id="file"
          type="file"
          accept=".pptx,.mp4,.mov,.mp3,.m4a,.wav,.webm,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm mb-3"
        />
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button
          type="submit"
          disabled={uploading || !file}
          className="rounded px-4 py-2 font-medium disabled:opacity-50"
          style={{ background: "var(--theme-primary)", color: "var(--theme-bg)" }}
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          {tenant?.monthly_generation_limit ?? "-"} uploads/month on the {tenant?.plan_tier ?? "free"} plan.
          Uploading creates the record and stores the file -- generating the actual quiz content from it is a
          separate step not built yet (see dashboard/README.md).
        </p>
      </form>

      <h2 className="text-sm font-semibold text-gray-400 mb-2">Your content sets</h2>
      {loadingList ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : contentSets.length === 0 ? (
        <p className="text-gray-500 text-sm">Nothing uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-white/10 border border-white/10 rounded-lg overflow-hidden">
          {contentSets.map((cs) => (
            <li key={cs.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{cs.title}</span>
              <span className="flex items-center gap-3 text-gray-500">
                <span className="uppercase text-xs">{cs.source_type}</span>
                <StatusBadge status={cs.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ContentSet["status"] }) {
  const colors: Record<ContentSet["status"], string> = {
    pending: "bg-gray-500/20 text-gray-300",
    processing: "bg-yellow-500/20 text-yellow-300",
    ready: "bg-green-500/20 text-green-300",
    failed: "bg-red-500/20 text-red-300",
  };
  return <span className={`px-2 py-0.5 rounded text-xs ${colors[status]}`}>{status}</span>;
}
