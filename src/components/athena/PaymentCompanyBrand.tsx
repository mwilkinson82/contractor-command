import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { validatePaymentLogo, MAX_COMPANY_LOGO_BYTES, resolvePaymentBrand } from "@/lib/payment-applications/brand";

/** Company is derived from the authorized job, never from a typed company name. */
export function PaymentCompanyBrand({ jobId, actorId }: { jobId: string; actorId: string }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const uploadAttempt = useRef<{path: string; bytes: Uint8Array} | null>(null);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const data = useQuery({
    queryKey: ["payment-company-brand", jobId, actorId], retry: false,
    queryFn: async () => {
      const j = await supabase.from("mcp_jobs").select("id,company_id").eq("id", jobId).single();
      if (j.error || j.data?.id !== jobId || !j.data.company_id) throw Error("Company details are unavailable.");
      const id = j.data.company_id;
      const [c, m] = await Promise.all([
        supabase.from("mcp_companies").select("id,name,logo_url").eq("id", id).single(),
        supabase.from("mcp_company_members").select("company_id,user_id,role").eq("company_id", id).eq("user_id", actorId).maybeSingle(),
      ]);
      if (c.error || c.data?.id !== id || m.error || m.data?.company_id !== id || m.data.user_id !== actorId) throw Error("Company details are unavailable.");
      const brand = await resolvePaymentBrand({ companyName: c.data.name, logoUrl: c.data.logo_url, backendUrl: import.meta.env.VITE_SUPABASE_URL });
      return { ...c.data, owner: m.data.role === "owner", logoAvailable: !!brand.logo };
    },
  });
  async function saveName() {
    if (!data.data?.owner || busy || inFlight.current || !name.trim() || name.trim().length > 200) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const user = await supabase.auth.getUser();
      if (!active.current || user.error || user.data.user?.id !== actorId) throw Error();
      const r = await supabase.rpc("mcp_company_save", { _company: data.data.id, _p: { name: name.trim() } });
      if (r.error || r.data !== data.data.id) throw Error();
      const fresh = await data.refetch();
      if (fresh.data?.name !== name.trim()) throw Error();
      setName(""); setMessage("Company name saved.");
    } catch { setMessage("Could not confirm the company name. Reload before trying again."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  async function saveLogo() {
    if (!data.data?.owner || busy || inFlight.current || (!file && !uploadedUrl)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    let url = uploadedUrl;
    try {
      if (!url && file) {
        if (file.size < 1 || file.size > MAX_COMPANY_LOGO_BYTES) throw Error("Choose a PNG or JPEG no larger than 1 MB.");
        const bytes = new Uint8Array(await file.arrayBuffer()), format = await validatePaymentLogo(bytes);
        if (!active.current || !format || (format === "PNG" ? file.type !== "image/png" : file.type !== "image/jpeg")) throw Error("Choose a valid PNG or JPEG no larger than 2048 pixels in either dimension. If the PNG isn't supported, re-export it as a plain, non-interlaced 8-bit PNG without extra metadata, or use JPEG.");
        let attempt = uploadAttempt.current;
        if (!attempt) {
          const path = `${actorId}/athena-${data.data.id}-${crypto.randomUUID()}.${format === "PNG" ? "png" : "jpg"}`;
          attempt = { path, bytes }; uploadAttempt.current = attempt;
          const upload = await supabase.storage.from("company-logos").upload(path, file, { contentType: file.type, upsert: false });
          if (upload.error) throw Error("Logo upload could not be confirmed. Check the same upload before continuing.");
        } else {
          const read = await supabase.storage.from("company-logos").download(attempt.path);
          if (read.error || !read.data) throw Error("The logo upload is still unconfirmed. Check again before choosing another image.");
          const actual = new Uint8Array(await read.data.arrayBuffer());
          if (actual.length !== attempt.bytes.length || !actual.every((v,i)=>v === attempt!.bytes[i])) throw Error("The uploaded logo does not match the selected image. No profile change was made.");
        }
        const path = attempt.path;
        url = supabase.storage.from("company-logos").getPublicUrl(path).data.publicUrl;
        if (!active.current) return;
        setUploadedUrl(url);
      }
      const user = await supabase.auth.getUser();
      if (!active.current || user.error || user.data.user?.id !== actorId) throw Error("Your session changed. Reopen company branding before saving.");
      const result = await supabase.rpc("mcp_company_brand_save", { _company: data.data.id, _p: { logo_url: url } });
      if (result.error) throw Error("Logo uploaded, but the company profile save could not be confirmed. Retry the same logo or reload.");
      const fresh = await data.refetch();
      if (fresh.data?.logo_url !== url || !fresh.data.logoAvailable) throw Error("The profile save or logo display could not be confirmed. Retry the same logo or reload.");
      setFile(null); setUploadedUrl(null); uploadAttempt.current = null; setMessage("Company logo saved.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not confirm the logo save."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  }
  if (data.isPending) return <p>Loading company branding…</p>;
  if (!data.data) return <p role="status">Company branding is unavailable.</p>;
  return <details className="pa-line"><summary>Company branding for this job</summary>
    <p>Company: <strong>{data.data.name}</strong> · {data.data.id}</p>
    <p>{data.data.logoAvailable ? "The configured logo is ready for documents." : data.data.logo_url ? "The configured logo cannot be used in this document; the company name will appear." : "No logo is configured; the company name will appear on the document."}</p>
    {data.data.owner ? <>
      <label>Company name <input maxLength={200} value={name} placeholder={data.data.name} onChange={e=>setName(e.target.value)} /></label>
      <button type="button" disabled={busy || !name.trim()} onClick={()=>void saveName()}>Save company name</button>
      <label>Company logo <input type="file" accept="image/png,image/jpeg" disabled={busy || !!uploadedUrl || !!uploadAttempt.current} onChange={e=>{setFile(e.target.files?.[0] ?? null);setMessage("");}} /></label>
      <p>PNG or JPEG, up to 1 MB. The logo is stored as a public image for your company documents.</p>
      <button type="button" disabled={busy || (!file && !uploadedUrl)} onClick={()=>void saveLogo()}>{uploadedUrl ? "Retry same logo save" : uploadAttempt.current ? "Check same logo upload" : "Save company logo"}</button>
    </> : <p>Only a company owner can change this branding.</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
