import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2, Check } from "lucide-react";
import { submitCallTopic } from "@/lib/topics.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function AosFeatureSubmit() {
  const submit = useServerFn(submitCallTopic);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    title: "",
    highlight: "",
    critique: "",
    context: "",
  });

  const reset = () => {
    setForm({ title: "", highlight: "", critique: "", context: "" });
    setDone(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      toast.error("Give your AOS build a short name.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await submit({
        data: {
          kind: "AOS Feature",
          title,
          winLooksLike: form.highlight,
          needsPressure: form.critique,
          alreadyTried: form.context,
        },
      });
      if (res.ok) {
        setDone(true);
        toast.success("Submitted — Marshall will review for the next call.");
      } else {
        toast.error(res.error || "Could not submit.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-muted/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[560px]">
          <p className="label-mono inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Featured AOS — this Sunday's call
          </p>
          <h3 className="mt-2 font-display text-[18px] leading-snug">
            Want Marshall to review your AOS live on the next Circle call?
          </h3>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Submit your build to be featured. Marshall picks one member each call to walk through, critique, and pressure-test in front of the room.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) reset();
          }}
        >
          <DialogTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90">
              <Sparkles className="h-3 w-3" /> Submit my AOS
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Submit your AOS for review</DialogTitle>
              <DialogDescription>
                Marshall will pick one build per call. The more specific you are about what to pressure-test, the better the feedback.
              </DialogDescription>
            </DialogHeader>

            {done ? (
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-[13px]">
                <p className="flex items-center gap-2 font-medium">
                  <Check className="h-4 w-4 text-signal" /> You're in the pool.
                </p>
                <p className="mt-2 text-muted-foreground">
                  If selected, you'll get an email before the call so you can be ready to walk through it live.
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="aos-title">Workspace / company name</Label>
                  <Input
                    id="aos-title"
                    placeholder="e.g. Wilkinson Construction — AOS"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    maxLength={200}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aos-highlight">What you're most proud of</Label>
                  <Textarea
                    id="aos-highlight"
                    placeholder="What part of your AOS do you want to show off?"
                    value={form.highlight}
                    onChange={(e) => setForm({ ...form, highlight: e.target.value })}
                    maxLength={2000}
                    rows={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aos-critique">Where you want pressure</Label>
                  <Textarea
                    id="aos-critique"
                    placeholder="What do you want Marshall to critique or push back on?"
                    value={form.critique}
                    onChange={(e) => setForm({ ...form, critique: e.target.value })}
                    maxLength={2000}
                    rows={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="aos-context">Context the room should know</Label>
                  <Textarea
                    id="aos-context"
                    placeholder="Stage of business, what's installed, who runs it, anything we should know before opening it up."
                    value={form.context}
                    onChange={(e) => setForm({ ...form, context: e.target.value })}
                    maxLength={2000}
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
                  >
                    {submitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Submit for review
                  </button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </article>
  );
}
