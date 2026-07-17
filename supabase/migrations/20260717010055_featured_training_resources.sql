ALTER TABLE public.replays
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_url text;

CREATE UNIQUE INDEX IF NOT EXISTS replays_single_featured_idx
  ON public.replays ((featured))
  WHERE featured;

CREATE TABLE IF NOT EXISTS public.replay_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_id uuid NOT NULL REFERENCES public.replays(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (replay_id, template_id)
);

CREATE INDEX IF NOT EXISTS replay_resources_replay_sort_idx
  ON public.replay_resources (replay_id, sort_order, created_at);

ALTER TABLE public.replay_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read replay resources" ON public.replay_resources;
CREATE POLICY "members read replay resources"
  ON public.replay_resources
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.replays
      WHERE replays.id = replay_resources.replay_id
        AND replays.published
        AND public.can_read_replay_category(auth.uid(), replays.category)
    )
    AND EXISTS (
      SELECT 1
      FROM public.templates
      WHERE templates.id = replay_resources.template_id
        AND templates.published
        AND public.has_tier_at_least(auth.uid(), 'circle')
    )
  );

DROP POLICY IF EXISTS "admins manage replay resources" ON public.replay_resources;
CREATE POLICY "admins manage replay resources"
  ON public.replay_resources
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.replay_resources TO authenticated;

INSERT INTO public.replays (
  title,
  description,
  video_url,
  share_url,
  duration_minutes,
  recorded_at,
  tags,
  published,
  category,
  featured
)
SELECT
  'Daily Project WIP Implementation',
  'A practical implementation session for connecting field activity, crew hours, installed quantities, CPM activities, SOV lines, billing events, and IOR so production becomes provable and billable every day.',
  'https://www.loom.com/embed/22d11e96c7084343b7160092a53575b9',
  'https://www.loom.com/share/22d11e96c7084343b7160092a53575b9',
  12,
  '2026-07-09T21:00:00Z'::timestamptz,
  ARRAY['Daily WIP', 'Field Tracking', 'Billing', 'IOR', 'Implementation'],
  true,
  'circle_call'::public.replay_category,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.replays WHERE title = 'Daily Project WIP Implementation'
);

UPDATE public.replays
SET
  description = 'A practical implementation session for connecting field activity, crew hours, installed quantities, CPM activities, SOV lines, billing events, and IOR so production becomes provable and billable every day.',
  video_url = 'https://www.loom.com/embed/22d11e96c7084343b7160092a53575b9',
  share_url = 'https://www.loom.com/share/22d11e96c7084343b7160092a53575b9',
  duration_minutes = 12,
  tags = ARRAY['Daily WIP', 'Field Tracking', 'Billing', 'IOR', 'Implementation'],
  published = true,
  category = 'circle_call'::public.replay_category,
  featured = false
WHERE title = 'Daily Project WIP Implementation';

UPDATE public.replays SET featured = false WHERE featured;

INSERT INTO public.replays (
  title,
  description,
  video_url,
  share_url,
  duration_minutes,
  recorded_at,
  tags,
  published,
  category,
  featured
)
SELECT
  'The Contractor Growth Myth',
  'Bigger contracts do not automatically create bigger companies. This training shows how revenue survives five gates—contracted, executable, produced, billable, and collected—and how project concurrency, Daily WIP, billing readiness, and IOR determine real throughput.',
  'https://www.tella.tv/video/vid_cmrnzc5c403jh04l4f7py9gdz/embed?b=0&title=1&a=1&loop=0&t=0&muted=0&wt=0&o=1',
  'https://video.alpcontractorcircle.com/video/the-contractor-growth-myth-9gdz',
  26,
  '2026-07-16T16:00:00Z'::timestamptz,
  ARRAY['Revenue Throughput', 'Growth', 'Daily WIP', 'Billing', 'IOR'],
  true,
  'circle_call'::public.replay_category,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.replays WHERE title = 'The Contractor Growth Myth'
);

UPDATE public.replays
SET
  description = 'Bigger contracts do not automatically create bigger companies. This training shows how revenue survives five gates—contracted, executable, produced, billable, and collected—and how project concurrency, Daily WIP, billing readiness, and IOR determine real throughput.',
  video_url = 'https://www.tella.tv/video/vid_cmrnzc5c403jh04l4f7py9gdz/embed?b=0&title=1&a=1&loop=0&t=0&muted=0&wt=0&o=1',
  share_url = 'https://video.alpcontractorcircle.com/video/the-contractor-growth-myth-9gdz',
  duration_minutes = 26,
  tags = ARRAY['Revenue Throughput', 'Growth', 'Daily WIP', 'Billing', 'IOR'],
  published = true,
  category = 'circle_call'::public.replay_category,
  featured = true
WHERE title = 'The Contractor Growth Myth';

INSERT INTO public.templates (
  title,
  description,
  category,
  file_type,
  pages,
  badge,
  featured,
  published,
  highlights
)
SELECT
  'Contractor Revenue Throughput — Client Field Guide',
  'The implementation companion for The Contractor Growth Myth: the five-gate revenue chain, four-number audit, portfolio throughput worksheet, Daily WIP and handoff checklists, weekly IOR review, and a 30-day implementation plan.',
  'Revenue Throughput',
  'pdf',
  '6 pages',
  'NEW',
  true,
  true,
  ARRAY['Four-number audit', 'Portfolio throughput worksheet', 'Daily WIP checklist', '30-day implementation plan']
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates
  WHERE title = 'Contractor Revenue Throughput — Client Field Guide'
);

INSERT INTO public.templates (
  title,
  description,
  category,
  file_type,
  pages,
  badge,
  featured,
  published,
  highlights
)
SELECT
  'Contractor Revenue Throughput — Teaching Deck',
  'The 14-slide teaching deck behind The Contractor Growth Myth, including the five-gate conversion chain, throughput equation, capacity law, project phasing, field-to-cash chain, and four-number audit.',
  'Revenue Throughput',
  'pdf',
  '14 slides',
  'NEW',
  false,
  true,
  ARRAY['Five-gate conversion chain', 'Capacity law', 'Field-to-cash chain', 'Four-number audit']
WHERE NOT EXISTS (
  SELECT 1 FROM public.templates
  WHERE title = 'Contractor Revenue Throughput — Teaching Deck'
);

INSERT INTO public.replay_resources (replay_id, template_id, sort_order)
SELECT replay.id, template.id, resources.sort_order
FROM public.replays AS replay
CROSS JOIN (
  VALUES
    ('Contractor Revenue Throughput — Client Field Guide'::text, 0),
    ('Contractor Revenue Throughput — Teaching Deck'::text, 1)
) AS resources(template_title, sort_order)
JOIN public.templates AS template ON template.title = resources.template_title
WHERE replay.title = 'The Contractor Growth Myth'
ON CONFLICT (replay_id, template_id)
DO UPDATE SET sort_order = EXCLUDED.sort_order;
