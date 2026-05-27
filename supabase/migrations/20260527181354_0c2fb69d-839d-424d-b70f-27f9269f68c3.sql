UPDATE public.subscriptions
SET tier = 'circle'::public.app_tier,
    metadata = metadata || jsonb_build_object('manual_tier_fix','justin_legacy_circle_price'),
    updated_at = now()
WHERE stripe_subscription_id = 'sub_1TQVkXJdDAUSVXbNQJlkJFvi';